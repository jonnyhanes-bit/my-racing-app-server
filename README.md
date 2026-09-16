# My Racing App Server V2

Secure Render proxy for Racing Alpha.

Environment variable:
RACING_ALPHA_API_KEY=your_private_key

Endpoints:
- GET /api/health
- GET /api/today
- GET /api/race/:id
- GET /api/jockeys/in-form

The app uses Racing Alpha's documented `/today` and `/races/{race_id}` endpoints.
It does not expose the API key to the browser.

Racing Alpha attribution is required on the free tier.
