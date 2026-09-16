# My Racing App — secure API bridge

This tiny server keeps your Racing Alpha API key out of the phone/browser.

## 1. Upload to a GitHub repository
Create a new repository and upload:
- server.js
- package.json
- .env.example

Do NOT upload your real API key.

## 2. Deploy
On Render, create a new Web Service from the GitHub repository.
Build command:
npm install
Start command:
npm start

Add an Environment Variable:
Name: RACING_ALPHA_API_KEY
Value: your private Racing Alpha key

## 3. Test
Open:
https://YOUR-SERVICE.onrender.com/api/health

You should see JSON saying ok=true.

Then:
https://YOUR-SERVICE.onrender.com/api/today

## 4. Connect the phone app
Change the app's API base from the provider URL to:
https://YOUR-SERVICE.onrender.com/api

The browser app then calls /today and /jockeys/in-form through your server.

## Security
Keep the key only in the hosting provider's environment variables.
Do not put the key into the HTML/JavaScript or GitHub.
