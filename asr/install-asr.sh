#!/usr/bin/env bash
# 幂等安装 alphax-asr (GLM-ASR CPU 推理服务) 的依赖与模型权重.
# 详见 README.md. 在服务器上跑: bash /opt/alphax/asr/install-asr.sh
set -euo pipefail

ASR_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$ASR_DIR/venv"
MODEL_ID_MS="ZhipuAI/GLM-ASR-Nano-2512"   # ModelScope (墙内原生 CDN, 首选)
MODEL_ID_HF="zai-org/GLM-ASR-Nano-2512"   # HuggingFace (兜底, 走 HF_ENDPOINT 镜像)
MODEL_DIR="$ASR_DIR/models/GLM-ASR-Nano-2512"
PYPI="${PYPI_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"   # 墙内可达镜像

echo "== [1/5] system deps (ffmpeg + python venv) =="
need_apt=0
command -v ffmpeg >/dev/null 2>&1 || need_apt=1
python3 -c "import ensurepip" >/dev/null 2>&1 || need_apt=1   # ensurepip = python3-venv 是否齐全
if [ "$need_apt" = "1" ]; then
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg python3-venv python3-dev
fi
ffmpeg -version | head -1

echo "== [2/5] venv =="
# venv 损坏 (缺 python 或 pip 不可用) 则重建 — 容错首次 python3-venv 缺失的失败.
if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -m pip --version >/dev/null 2>&1; then
  rm -rf "$VENV"
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
. "$VENV/bin/activate"
python -m pip install -U pip -i "$PYPI"

echo "== [3/5] torch (CPU wheel) =="
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

echo "== [4/5] python deps =="
# 先试 PyPI 上的 transformers>=5.0; 失败则退 git 源码 (GLM-ASR 需要 5.0 的模型类).
if ! pip install -U -r "$ASR_DIR/requirements.txt" -i "$PYPI"; then
  echo "!! transformers>=5.0 PyPI 安装失败, 退到 git 源码"
  pip install "git+https://github.com/huggingface/transformers.git"
  grep -v '^transformers' "$ASR_DIR/requirements.txt" | pip install -U -r /dev/stdin -i "$PYPI"
fi
python -c "import transformers, torch; print('transformers', transformers.__version__, '| torch', torch.__version__)"

echo "== [5/5] model download =="
if [ ! -f "$MODEL_DIR/config.json" ]; then
  # 墙内首选 ModelScope (原生 CDN, 稳); 失败退 HF 镜像 ($HF_ENDPOINT).
  if ! python - "$MODEL_ID_MS" "$MODEL_DIR" <<'PY'
import sys
from modelscope import snapshot_download
snapshot_download(sys.argv[1], local_dir=sys.argv[2])
print("modelscope download ok")
PY
  then
    echo "!! ModelScope 下载失败, 退到 HF 镜像"
    python - "$MODEL_ID_HF" "$MODEL_DIR" <<'PY'
import sys
from huggingface_hub import snapshot_download
snapshot_download(sys.argv[1], local_dir=sys.argv[2])
print("hf download ok")
PY
  fi
fi
du -sh "$MODEL_DIR" || true

echo "INSTALL_DONE rc=0"
