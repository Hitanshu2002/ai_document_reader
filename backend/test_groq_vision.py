import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
api_key = os.getenv("GROQ_API_KEY")
print(f"Loaded API key: {api_key[:10]}...{api_key[-10:] if api_key else ''}")

client = Groq(api_key=api_key)

print("\n--- Testing meta-llama/llama-4-scout-17b-16e-instruct ---")
try:
    response = client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[{"role": "user", "content": "Hello! Are you online?"}],
        max_tokens=50
    )
    print("Success! Response:")
    print(response.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")

print("\n--- Listing available models ---")
try:
    models = client.models.list()
    for m in models.data:
        if "vision" in m.id or "llama" in m.id:
            print(f"- {m.id}")
except Exception as e:
    print(f"Error listing models: {e}")
