require('dotenv').config(); // For local testing, loads from .env (ignored by Render). On Render, variables are injected.
const express = require('express');
const axios = require('axios'); // For making HTTP requests to OpenAI and Instagram Graph API
const app = express();
const port = process.env.PORT || 3000;

// Retrieve environment variables
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INSTAGRAM_PAGE_ACCESS_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID; // New: Assistant ID

// --- Ensure all necessary tokens are loaded ---
if (!WEBHOOK_VERIFY_TOKEN || !OPENAI_API_KEY || !INSTAGRAM_PAGE_ACCESS_TOKEN || !OPENAI_ASSISTANT_ID) {
    console.error('Missing one or more critical environment variables!');
    if (!WEBHOOK_VERIFY_TOKEN) console.error('WEBHOOK_VERIFY_TOKEN is missing!');
    if (!OPENAI_API_KEY) console.error('OPENAI_API_KEY is missing!');
    if (!INSTAGRAM_PAGE_ACCESS_TOKEN) console.error('INSTAGRAM_PAGE_ACCESS_TOKEN is missing!');
    if (!OPENAI_ASSISTANT_ID) console.error('OPENAI_ASSISTANT_ID is missing!');
    // In a production app, you might want to exit here or handle this more gracefully.
}

// Middleware to parse JSON request bodies
app.use(express.json());

// Utility to delay execution (for polling Assistant status)
const delay = ms => new Promise(res => setTimeout(res, ms));

// ================================
// WEBHOOK VERIFICATION (GET request)
// ================================
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    // Debug logs (keep these for now, they are very helpful!)
    console.log("--- Webhook Verification Attempt ---");
    console.log("Server's WEBHOOK_VERIFY_TOKEN (from env):", WEBHOOK_VERIFY_TOKEN);
    console.log("Token received from Meta (hub.verify_token):", token);

    if (mode && token) {
        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('Webhook verification failed: Token mismatch');
            res.sendStatus(403);
        }
    } else {
        console.error('Webhook verification failed: Missing parameters');
        res.status(400).send("Missing parameters");
    }
});

// ================================
// INCOMING MESSAGES (POST request)
// ================================
app.post('/webhook', async (req, res) => {
    const body = req.body;

    console.log('Received webhook data:', JSON.stringify(body, null, 2));

    if (body.object === 'instagram') {
        for (const entry of body.entry) {
            for (const messaging_event of entry.messaging) {
                const senderId = messaging_event.sender.id;
                const messageText = messaging_event.message ? messaging_event.message.text : '';

                console.log(`Message from <span class="math-inline">\{senderId\}\: "</span>{messageText}"`);

                if (messaging_event.message && !messaging_event.message.is_echo) {
                    if (messageText) {
                        try {
                            // 1. Get AI response from OpenAI Assistant
                            const aiResponse = await getOpenAIAssistantResponse(messageText);
                            console.log(`AI Assistant Response: "${aiResponse}"`);

                            // 2. Send AI response back to Instagram
                            await sendInstagramMessage(senderId, aiResponse);
                            console.log(`Successfully sent message to ${senderId}`);

                        } catch (error) {
                            console.error('Error processing message or sending reply:', error.response ? error.response.data : error.message);
                            await sendInstagramMessage(senderId, "Sorry, I'm having trouble responding right now. Please try again later.");
                        }
                    } else {
                        await sendInstagramMessage(senderId, "Sorry, I can currently only process text messages.");
                        console.log(`Received non-text message from ${senderId}`);
                    }
                }
            }
        }
    }
    res.status(200).send('EVENT_RECEIVED');
});

// ================================
// OpenAI Assistant Integration Function
// ================================
async function getOpenAIAssistantResponse(userMessage) {
    if (!OPENAI_ASSISTANT_ID) {
        throw new Error("OPENAI_ASSISTANT_ID is not set in environment variables.");
    }

    const openaiApiUrl = 'https://api.openai.com/v1';
    const headers = {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2' // Required for Assistants API
    };

    try {
        // 1. Create a new thread
        console.log("Creating new thread...");
        const threadResponse = await axios.post(`${openaiApiUrl}/threads`, {}, { headers });
        const threadId = threadResponse.data.id;
        console.log(`Thread created with ID: ${threadId}`);

        // 2. Add a message to the thread
        console.log("Adding message to thread...");
        await axios.post(`<span class="math-inline">\{openaiApiUrl\}/threads/</span>{threadId}/messages`,
            {
                role: "user",
                content: userMessage
            },
            { headers }
        );
        console.log("Message added to thread.");

        // 3. Run the Assistant on the thread
        console.log("Running Assistant...");
        const runResponse = await axios.post(`<span class="math-inline">\{openaiApiUrl\}/threads/</span>{threadId}/runs`,
            { assistant_id: OPENAI_ASSISTANT_ID },
            { headers }
        );
        let runId = runResponse.data.id;
        console.log(`Run created with ID: ${runId}`);

        // 4. Poll the run status until completed
        let runStatus;
        do {
            await delay(1000); // Wait for 1 second before polling again
            const statusResponse = await axios.get(`<span class="math-inline">\{openaiApiUrl\}/threads/</span>{threadId}/runs/${runId}`, { headers });
            runStatus = statusResponse.data.status;
            console.log(`Run status: ${runStatus}`);
        } while (runStatus !== 'completed' && runStatus !== 'failed' && runStatus !== 'cancelled' && runStatus !== 'expired');

        if (runStatus !== 'completed') {
            throw new Error(`Assistant run failed or was not completed. Status: ${runStatus}`);
        }

        // 5. Retrieve messages from the thread to get the Assistant's response
        console.log("Retrieving messages from thread...");
        const messagesResponse = await axios.get(`<span class="math-inline">\{openaiApiUrl\}/threads/</span>{threadId}/messages`, { headers });
        const messages = messagesResponse.data.data;

        // Find the latest message from the assistant
        const assistantMessage = messages.find(
            msg => msg.role === 'assistant' && msg.run_id === runId
        );

        if (assistantMessage && assistantMessage.content && assistantMessage.content.length > 0) {
            // Assuming the content is text, it will be in a text object
            const textContent = assistantMessage.content.find(content => content.type === 'text');
            if (textContent) {
                return textContent.text.value;
            }
        }
        throw new Error("No response found from Assistant.");

    } catch (error) {
        console.error('Error with OpenAI Assistant API:', error.response ? error.response.data : error.message);
        throw new Error('Failed to get response from OpenAI Assistant.');
    }
}

// ================================
// Instagram Messaging Function
// ================================
async function sendInstagramMessage(recipientId, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v20.0/me/messages`, // Use latest Graph API version
            {
                recipient: { id: recipientId },
                message: { text: text },
                messaging_type: "RESPONSE"
            },
            {
                params: {
                    access_token: INSTAGRAM_PAGE_ACCESS_TOKEN
                }
            }
        );
    } catch (error) {
        console.error('Error sending message to Instagram:', error.response ? error.response.data : error.message);
        throw new Error('Failed to send message to Instagram.');
    }
}

// ================================
// Simple Root Endpoint (for health checks)
// ================================
app.get('/', (req, res) => {
    res.send('Instagram AI Bot server is running!');
});

// ================================
// Start the Server
// ================================
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});