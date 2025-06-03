// We will NOT load dotenv here when deployed on Render,
// as Render injects environment variables directly.
// However, it's good practice for local testing if you were to do it.
// require('dotenv').config();

const express = require('express');
const app = express();
// Render will set process.env.PORT, otherwise use 3000 for local testing
const port = process.env.PORT || 3000;

// Your Webhook Verify Token will come from Render's environment variables
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// Middleware to parse JSON request bodies
app.use(express.json());

// Webhook endpoint for Instagram Messenger
app.get('/webhook', (req, res) => {
    // Parse the query params
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    // Check if a token and mode is in the query string of the request
    if (mode && token) {
        // Check the mode and token sent is correct
        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            // Respond with the challenge token from the request
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            // Respond with '403 Forbidden' if verify tokens do not match
            console.error('Webhook verification failed: Token mismatch');
            res.sendStatus(403);
        }
    } else {
        console.error('Webhook verification failed: Missing parameters');
        res.status(400).send("Missing parameters");
    }
});

app.post('/webhook', (req, res) => {
    let body = req.body;

    // Log the webhook payload for inspection
    console.log('Received webhook data:', JSON.stringify(body, null, 2));

    // Check if this is an Instagram message
    if (body.object === 'instagram') {
        body.entry.forEach(entry => {
            entry.messaging.forEach(messaging_event => {
                if (messaging_event.message) {
                    const senderId = messaging_event.sender.id;
                    const messageText = messaging_event.message.text;

                    console.log(`Message from ${senderId}: ${messageText}`);
                    // For now, we'll just acknowledge receipt.
                    // OpenAI integration and sending replies will come later.
                } else {
                    console.log('Received non-message webhook event:', messaging_event);
                }
            });
        });
    }
    res.status(200).send('EVENT_RECEIVED'); // Always respond with 200 OK
});

// Simple root endpoint to confirm server is running
app.get('/', (req, res) => {
    res.send('Instagram AI Bot server is running!');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});