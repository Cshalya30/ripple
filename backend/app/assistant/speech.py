"""Speech-to-text with a local Whisper model (faster-whisper), ported from the Streamlit app.

Audio never leaves the server; only the transcript goes on to Gemini.
faster-whisper is optional (see requirements-voice.txt). Without it the
endpoint returns 503 and the rest of the API keeps working.
"""

from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path

from .chat import AssistantUnavailable

STT_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
MAX_AUDIO_BYTES = 10 * 1024 * 1024
ALLOWED_SUFFIXES = {".wav", ".webm", ".ogg", ".mp3", ".m4a", ".mp4", ".mpeg", ".flac"}


@lru_cache(maxsize=1)
def _whisper(model_size: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise AssistantUnavailable("faster-whisper is not installed (pip install -r requirements-voice.txt)") from exc
    try:
        # First use downloads the model from Hugging Face, so the server needs internet once.
        return WhisperModel(model_size, device="cpu", compute_type="int8")
    except Exception as exc:
        raise AssistantUnavailable(f"Whisper model '{model_size}' couldn't be loaded ({type(exc).__name__})") from exc


def transcribe(audio: bytes, filename: str) -> dict:
    suffix = Path(filename or "audio.wav").suffix.lower() or ".wav"
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError("Unsupported audio format.")
    if not audio:
        raise ValueError("The recording is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError("Recording is too long. Keep it under about a minute.")
    model = _whisper(STT_MODEL_SIZE)
    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio)
            temp_path = tmp.name
        segments, info = model.transcribe(temp_path, beam_size=3, vad_filter=True)
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        return {"transcript": transcript, "language": getattr(info, "language", None)}
    except AssistantUnavailable:
        raise
    except Exception as exc:
        raise ValueError("Couldn't read that recording. Try again closer to the microphone.") from exc
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


def status() -> dict:
    try:
        import faster_whisper  # noqa: F401

        installed = True
    except ImportError:
        installed = False
    return {"model": STT_MODEL_SIZE, "installed": installed}
