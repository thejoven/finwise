package signal

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/gin-gonic/gin"

	"alphax/server/internal/httpapi/auth"
)

// maxTranscribeBytes — 上传音频大小上限 (与 asr/asr_server.py 的 ASR_MAX_AUDIO_BYTES 对齐).
const maxTranscribeBytes = 12 << 20 // 12MB

// transcribe — 语音转写薄代理.
//
// 移动端录音 (multipart 字段 `audio`) → 这里 → GLM-ASR 内部服务 (/transcribe) → {"text"}.
// 不入库、不改信号表: 转写结果回填到录入文本框, 用户校对后才走 POST /v1/signals.
func (h *Handler) transcribe(c *gin.Context) {
	if _, ok := auth.UserID(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	if h.asrURL == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "asr disabled"})
		return
	}

	// 防御性大小上限 (移动端也会限制录音时长). +1KB 余量给 multipart 包头.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxTranscribeBytes+1024)
	file, hdr, err := c.Request.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing audio file: " + err.Error()})
		return
	}
	defer file.Close()
	if hdr.Size > maxTranscribeBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "audio too large"})
		return
	}

	// 重新打包成 multipart 转发给 ASR 服务. 文件名无关紧要 (ASR 端按内容用 ffmpeg 探测格式).
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("audio", "audio")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	if _, err := io.Copy(part, file); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "read audio failed"})
		return
	}
	if err := mw.Close(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, h.asrURL+"/transcribe", &buf)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := h.asrClient.Do(req)
	if err != nil {
		c.Error(err) //nolint:errcheck // gin logs it via middleware
		c.JSON(http.StatusBadGateway, gin.H{"error": "asr unavailable"})
		return
	}
	defer resp.Body.Close()

	// 直接透传 ASR 的 JSON 响应 ({"text","elapsed_ms"} 或 error). 限读 1MB 防御.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}
