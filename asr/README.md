# alphax-asr — GLM-ASR 语音转写服务

[GLM-ASR-Nano-2512](https://github.com/zai-org/GLM-ASR)（1.5B，中文/粤语/方言优化）的
**CPU** 推理 HTTP 服务。被「手动新增信号」的语音输入复用：移动端录音 → Go
`POST /v1/signals/transcribe` 内部代理 → 本服务转写 → 文本回填到录入文本框。

> 服务器无 GPU（纯 CPU）。官方推荐的 SGLang 面向 GPU，这里改用 transformers + FastAPI。

## 部署（服务器 root@192.168.1.205）

```bash
# 1) 从本机推代码 (在仓库根目录)
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_clh_520jwenlee" \
  --exclude venv --exclude models --exclude install.log \
  asr/ root@192.168.1.205:/opt/alphax/asr/

# 2) 装依赖 + 下模型 (幂等, 首次较慢: torch + 1.5B 权重)
ssh root@192.168.1.205 'bash /opt/alphax/asr/install-asr.sh 2>&1 | tee /opt/alphax/asr/install.log'

# 3) 装 systemd 服务
ssh root@192.168.1.205 'cp /opt/alphax/asr/alphax-asr.service /etc/systemd/system/ \
  && systemctl daemon-reload && systemctl enable --now alphax-asr'

# 4) 验证
ssh root@192.168.1.205 'curl -s http://127.0.0.1:18900/healthz'
```

## 日常迭代

改 `asr_server.py` 后：

```bash
rsync ... asr/asr_server.py root@192.168.1.205:/opt/alphax/asr/
ssh root@192.168.1.205 'systemctl restart alphax-asr && journalctl -u alphax-asr -n 30 --no-pager'
```

## 配置（`/opt/alphax/asr/.env`，可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `ASR_DTYPE` | `float32` | CPU 上 fp32 更稳；`bfloat16` 省内存但旧 CPU 可能更慢 |
| `ASR_NUM_THREADS` | `0`（不动） | torch 线程数；72 核全开未必最快，benchmark 调 |
| `ASR_MAX_NEW_TOKENS` | `448` | 解码上限 |
| `ASR_PORT` | `18900` | 仅绑 127.0.0.1 |
| `ASR_MAX_AUDIO_BYTES` | `12582912` | 上传音频大小上限 (12MB) |

## 排错

- `curl /healthz` 返回 `loading` → 模型还在加载（冷启动几十秒）。
- ffmpeg 报错 → 上传音频损坏/格式不支持；服务会归一化为 16k 单声道 wav。
- 内存被 OOM → 调低 systemd `MemoryMax` 不解决根因，应换 `ASR_DTYPE=bfloat16` 或限制并发。
- transformers 版本 → GLM-ASR 需 5.0+；`install-asr.sh` 在 PyPI 无 5.0 时退到 git 源码。
