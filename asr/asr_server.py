"""
alphax-asr — GLM-ASR 的 CPU 推理 HTTP 服务.

只绑 127.0.0.1, 由 Go 后端 (POST /v1/signals/transcribe) 内部代理调用, 不对 LAN 暴露.

端点:
  GET  /healthz     健康检查 (模型是否加载完)
  POST /transcribe  multipart 字段 `audio` (任意音频) → {"text", "elapsed_ms"}

环境变量 (见 .env / systemd unit):
  ASR_MODEL_DIR     模型权重目录 (默认 ./models/GLM-ASR-Nano-2512)
  ASR_DTYPE         float32 (默认, CPU 稳) | bfloat16
  ASR_NUM_THREADS   torch 线程数 (默认 0 = 不动; benchmark 调优)
  ASR_MAX_NEW_TOKENS 解码上限 (默认 448, 约对应一段较长口述)
  ASR_PROMPT        转写指令
  ASR_HOST/ASR_PORT 监听地址 (默认 127.0.0.1:18900)
"""
import logging
import os
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from transformers import AutoProcessor, GlmAsrForConditionalGeneration

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("alphax-asr")

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("ASR_MODEL_DIR", os.path.join(HERE, "models", "GLM-ASR-Nano-2512"))
DTYPE_NAME = os.environ.get("ASR_DTYPE", "float32").lower()
NUM_THREADS = int(os.environ.get("ASR_NUM_THREADS", "0"))
MAX_NEW_TOKENS = int(os.environ.get("ASR_MAX_NEW_TOKENS", "448"))
PROMPT = os.environ.get("ASR_PROMPT", "请将这段音频逐字转写为文字。")
MAX_AUDIO_BYTES = int(os.environ.get("ASR_MAX_AUDIO_BYTES", str(12 * 1024 * 1024)))  # 12MB

_state: dict = {}


def _dtype() -> "torch.dtype":
    return torch.bfloat16 if DTYPE_NAME in ("bf16", "bfloat16") else torch.float32


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if NUM_THREADS > 0:
        torch.set_num_threads(NUM_THREADS)
    t0 = time.time()
    log.info("loading model from %s (dtype=%s, threads=%d)", MODEL_DIR, DTYPE_NAME, torch.get_num_threads())
    # 用带 LM 头的 ForConditionalGeneration 类 (AutoModel 只给基座 GlmAsrModel, 无 .generate).
    processor = AutoProcessor.from_pretrained(MODEL_DIR)
    model = GlmAsrForConditionalGeneration.from_pretrained(
        MODEL_DIR, dtype=_dtype(), device_map="cpu"
    )
    model.eval()
    _state["processor"] = processor
    _state["model"] = model
    log.info("model loaded in %.1fs", time.time() - t0)
    yield
    _state.clear()


app = FastAPI(title="alphax-asr", lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {
        "status": "ok" if "model" in _state else "loading",
        "model_loaded": "model" in _state,
        "dtype": DTYPE_NAME,
        "threads": torch.get_num_threads(),
    }


def _to_wav16k(src_path: str, dst_path: str) -> None:
    """ffmpeg 归一化任意音频为 16kHz 单声道 PCM wav (GLM-ASR 期望的输入)."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", src_path, "-ar", "16000", "-ac", "1", "-f", "wav", dst_path],
        check=True,
        capture_output=True,
    )


@torch.inference_mode()
def _run_asr(wav_path: str) -> str:
    processor = _state["processor"]
    model = _state["model"]
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "audio", "url": wav_path},
                {"type": "text", "text": PROMPT},
            ],
        }
    ]
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )
    # BatchFeature.to(dtype=) 只转浮点张量 (input_ids 等整型保持不变).
    inputs = inputs.to(device="cpu", dtype=_dtype())
    prompt_len = inputs["input_ids"].shape[1]
    outputs = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
    decoded = processor.batch_decode(outputs[:, prompt_len:], skip_special_tokens=True)
    return (decoded[0] if decoded else "").strip()


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if "model" not in _state:
        raise HTTPException(status_code=503, detail="model not loaded yet")

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "input")
        wav = os.path.join(td, "norm.wav")
        with open(src, "wb") as f:
            f.write(raw)
        try:
            _to_wav16k(src, wav)
        except subprocess.CalledProcessError as e:
            stderr = e.stderr.decode(errors="replace")[-300:] if e.stderr else ""
            raise HTTPException(status_code=400, detail=f"ffmpeg failed: {stderr}")

        t0 = time.time()
        text = _run_asr(wav)
        dt_ms = int((time.time() - t0) * 1000)

    log.info("transcribed %d bytes -> %d chars in %dms", len(raw), len(text), dt_ms)
    return {"text": text, "elapsed_ms": dt_ms}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("ASR_HOST", "127.0.0.1"),
        port=int(os.environ.get("ASR_PORT", "18900")),
        workers=1,
    )
