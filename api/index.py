from fastapi import FastAPI, Depends  # type: ignore
from fastapi.responses import StreamingResponse  # type: ignore
from pydantic import BaseModel  # type: ignore
from fastapi_clerk_auth import ClerkConfig, ClerkHTTPBearer, HTTPAuthorizationCredentials  # type: ignore
from openai import AzureOpenAI, OpenAI  # type: ignore
import json
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Clerk Configuration
clerk_config = ClerkConfig(jwks_url=os.getenv("CLERK_JWKS_URL"))
clerk_guard = ClerkHTTPBearer(clerk_config)

# Model configurations in order of priority
MODELS = [
    {
        "name": "Azure OpenAI",
        "model": os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5"),
        "api_key_env": "AZURE_OPENAI_API_KEY",
        "base_url": None,
        "provider": "azure",
        "wire_api": os.getenv("AZURE_OPENAI_WIRE_API", "responses"),
    },
    {
        "name": "OpenAI",
        "model": "gpt-4o-mini",
        "api_key_env": "OPENAI_API_KEY",
        "base_url": None, # Use default
        "provider": "openai",
        "wire_api": "chat",
    },
    {
        "name": "OpenRouter",
        "model": "meta-llama/llama-3.3-70b-instruct",
        "api_key_env": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "provider": "openai-compatible",
        "wire_api": "chat",
    },
    {
        "name": "Cerebras",
        "model": "llama3.1-8b",
        "api_key_env": "CEREBRAS_API_KEY",
        "base_url": "https://api.cerebras.ai/v1",
        "provider": "openai-compatible",
        "wire_api": "chat",
    },
    {
        "name": "Groq",
        "model": "llama-3.3-70b-versatile",
        "api_key_env": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1",
        "provider": "openai-compatible",
        "wire_api": "chat",
    },
]

class Visit(BaseModel):
    patient_name: str
    date_of_visit: str
    notes: str

system_prompt = """
You are provided with notes written by a doctor from a patient's visit.
Your job is to summarize the visit for the doctor and provide an email.
Reply with exactly three sections with the headings:
### Summary of visit for the doctor's records
### Next steps for the doctor
### Draft of email to patient in patient-friendly language
"""

def user_prompt_for(visit: Visit) -> str:
    return f"""Create the summary, next steps and draft email for:
Patient Name: {visit.patient_name}
Date of Visit: {visit.date_of_visit}
Notes:
{visit.notes}"""

def sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"

def build_client(model_cfg: dict, api_key: str):
    if model_cfg["provider"] == "azure":
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")

        if not azure_endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT not set")

        return AzureOpenAI(
            api_key=api_key,
            azure_endpoint=azure_endpoint,
            api_version=api_version,
        )

    client_params = {"api_key": api_key}
    if model_cfg["base_url"]:
        client_params["base_url"] = model_cfg["base_url"]

    return OpenAI(**client_params)

def stream_model_tokens(client, model_cfg: dict, messages: list[dict], user_prompt: str):
    timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "30"))

    if model_cfg.get("wire_api") == "responses":
        stream = client.responses.create(
            model=model_cfg["model"],
            instructions=system_prompt,
            input=user_prompt,
            stream=True,
            timeout=timeout,
        )

        for event in stream:
            if getattr(event, "type", "") == "response.output_text.delta":
                text = getattr(event, "delta", "")
                if text:
                    yield text
        return

    stream = client.chat.completions.create(
        model=model_cfg["model"],
        messages=messages,
        stream=True,
        timeout=timeout,
    )

    for chunk in stream:
        text = chunk.choices[0].delta.content
        if text:
            yield text

@app.post("/api")
def consultation_summary(
    visit: Visit,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id = creds.decoded["sub"]  # Available for tracking/auditing
    logger.info("User %s is requesting a consultation summary.", user_id)

    user_prompt = user_prompt_for(visit)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    def event_stream():
        errors = []
        yield sse_event("status", {
            "level": "info",
            "message": "Request received. Preparing model fallback chain.",
        })

        for model_cfg in MODELS:
            provider = model_cfg["name"]
            model = model_cfg["model"]
            api_key = os.getenv(model_cfg["api_key_env"])

            if not api_key:
                msg = f"{provider} skipped because {model_cfg['api_key_env']} is not configured."
                logger.warning(msg)
                errors.append(msg)
                yield sse_event("status", {
                    "level": "warning",
                    "provider": provider,
                    "model": model,
                    "message": msg,
                })
                continue

            had_tokens = False

            try:
                logger.info("Trying %s (%s).", provider, model)
                yield sse_event("status", {
                    "level": "info",
                    "provider": provider,
                    "model": model,
                    "wire_api": model_cfg.get("wire_api"),
                    "message": f"Trying {provider} with {model}.",
                })

                client = build_client(model_cfg, api_key)

                yield sse_event("status", {
                    "level": "info",
                    "provider": provider,
                    "model": model,
                    "message": f"Connected to {provider}. Starting stream.",
                })

                for text in stream_model_tokens(client, model_cfg, messages, user_prompt):
                    if not had_tokens:
                        had_tokens = True
                        logger.info("Streaming response from %s (%s).", provider, model)
                        yield sse_event("status", {
                            "level": "success",
                            "provider": provider,
                            "model": model,
                            "message": f"{provider} responded. Streaming output.",
                        })

                    yield sse_event("token", {"text": text})

                if had_tokens:
                    yield sse_event("done", {
                        "provider": provider,
                        "model": model,
                        "message": f"Completed with {provider}.",
                    })
                    return

                msg = f"{provider} completed without returning text."
                logger.warning(msg)
                errors.append(msg)
                yield sse_event("status", {
                    "level": "warning",
                    "provider": provider,
                    "model": model,
                    "message": msg,
                })

            except Exception as e:
                error_detail = f"{provider} failed: {str(e)}"
                logger.error(error_detail)
                errors.append(error_detail)

                if had_tokens:
                    yield sse_event("error", {
                        "provider": provider,
                        "model": model,
                        "message": f"{provider} stream failed after output started.",
                        "detail": str(e),
                    })
                    return

                yield sse_event("status", {
                    "level": "error",
                    "provider": provider,
                    "model": model,
                    "message": f"{provider} failed before streaming. Trying the next model.",
                    "detail": str(e),
                })

        logger.critical("All LLM providers failed to stream a response.")
        yield sse_event("error", {
            "message": "All AI models failed to respond.",
            "errors": errors,
        })

    return StreamingResponse(event_stream(), media_type="text/event-stream")
