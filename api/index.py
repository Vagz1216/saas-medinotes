from fastapi import FastAPI, HTTPException, Depends  # type: ignore
from fastapi.responses import StreamingResponse  # type: ignore
from pydantic import BaseModel  # type: ignore
from fastapi_clerk_auth import ClerkConfig, ClerkHTTPBearer, HTTPAuthorizationCredentials  # type: ignore
from openai import OpenAI  # type: ignore
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
        "name": "OpenAI",
        "model": "gpt-4o-mini",
        "api_key_env": "OPENAI_API_KEY",
        "base_url": None, # Use default
    },
    {
        "name": "OpenRouter",
        "model": "meta-llama/llama-3.3-70b-instruct",
        "api_key_env": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
    },
    {
        "name": "Cerebras",
        "model": "llama3.1-8b",
        "api_key_env": "CEREBRAS_API_KEY",
        "base_url": "https://api.cerebras.ai/v1",
    },
    {
        "name": "Groq",
        "model": "llama-3.3-70b-versatile",
        "api_key_env": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1",
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

@app.post("/api")
def consultation_summary(
    visit: Visit,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id = creds.decoded["sub"]  # Available for tracking/auditing
    logger.info(f"User {user_id} is requesting a consultation summary for {visit.patient_name}.")

    user_prompt = user_prompt_for(visit)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    errors = []
    for model_cfg in MODELS:
        api_key = os.getenv(model_cfg["api_key_env"])
        if not api_key:
            msg = f"Skipping {model_cfg['name']}: {model_cfg['api_key_env']} not set."
            logger.warning(msg)
            errors.append(msg)
            continue
            
        try:
            # Initialize client for each provider
            client_params = {"api_key": api_key}
            if model_cfg["base_url"]:
                client_params["base_url"] = model_cfg["base_url"]
            
            client = OpenAI(**client_params)
            
            logger.info(f"Attempting stream with {model_cfg['name']} ({model_cfg['model']})...")
            
            # Start the streaming request
            stream = client.chat.completions.create(
                model=model_cfg["model"],
                messages=messages,
                stream=True,
                timeout=10.0 # Fast fallback
            )
            
            logger.info(f"Successfully started stream from {model_cfg['name']}")

            def event_stream():
                try:
                    for chunk in stream:
                        text = chunk.choices[0].delta.content
                        if text:
                            lines = text.split("\n")
                            for line in lines[:-1]:
                                yield f"data: {line}\n\n"
                                yield "data:  \n"
                            yield f"data: {lines[-1]}\n\n"
                except Exception as stream_err:
                    error_msg = f"Stream interrupted from {model_cfg['name']}: {str(stream_err)}"
                    logger.error(error_msg)
                    yield f"data: [Error: {error_msg}]\n\n"

            return StreamingResponse(event_stream(), media_type="text/event-stream")
            
        except Exception as e:
            error_detail = f"{model_cfg['name']} stream initiation failed: {str(e)}"
            logger.error(error_detail)
            errors.append(error_detail)
            continue

    # Exhausted all fallbacks
    error_summary = "\n".join(errors)
    logger.critical("All LLM providers failed to start stream.")
    
    def error_stream():
        yield f"data: All AI models failed to respond.\n\n"
        yield f"data: Debug info:\n"
        for err in errors:
            yield f"data: - {err}\n"
        yield "\n"

    return StreamingResponse(error_stream(), media_type="text/event-stream")
