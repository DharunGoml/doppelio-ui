const wsUrlInput = document.getElementById("wsUrl");
const tenantIdInput = document.getElementById("tenantId");
const userIdInput = document.getElementById("userId");
const conversationIdInput = document.getElementById("conversationId");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const loginContainer = document.getElementById("container");
const mainContainer = document.getElementById("main-container");
const chatSection = document.querySelector(".chat-section");
const conversationList = document.querySelector(".conversation-list");
const sendBtn = document.querySelector(".send-btn");
const chatInput = document.getElementById("chatInput");
const chatContainer = document.querySelector(".chat-container");
const refreshBtn = document.querySelector(".refreshButton");
const newChatBtn = document.querySelector(".newChatButton").addEventListener("click", createNewConversation);
const selectModel = document.getElementById("modelSelect");
const statusIndicator = document.getElementById("status-indicator-new");
let websocket = null;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null; // Or AudioWorkletNode
let audioBuffer = []; // To store PCM data
let isRecording = false;
let expectAudio = false; // Flag to know if the next binary message is audio data
let currentChatId = null;

const TARGET_SAMPLE_RATE = 16000;
const CHAT_API_BASE = "http://localhost:8005"; //"https://hk16pwp3-8005.inc1.devtunnels.ms"
// const CHAT_API_BASE = "http://doppelio-goml-ecs-alb-1845578001.us-west-2.elb.amazonaws.com"
const UPLOAD_API_BASE = "http://doppelio-goml-ecs-alb-1845578001.us-west-2.elb.amazonaws.com:82";
let conversationId = null;
let selectedModel;
let sagemakerEndpointName = "";

function logMessage(message, type = "server") {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", type);
    messageDiv.textContent =
        typeof message === "object" ? JSON.stringify(message, null, 2) : message;
}

function createAndActivateNewChatItem() {
    const conversationList = document.querySelector(".conversation-list");
    // Remove any existing "New Chat" temp items
    conversationList.querySelectorAll('.conversation-item[data-temp-id]').forEach(item => item.remove());

    const newItem = document.createElement("div");
    newItem.className = "conversation-item active";
    newItem.textContent = "New Chat";
    const tempId = "new_" + Date.now();
    newItem.dataset.tempId = tempId;
    newItem.addEventListener("click", () => {
        activateConversationItem(newItem, null);
    });
    conversationList.prepend(newItem);
    activateConversationItem(newItem, null);
    return newItem;
}


// dropdown to select the model, default one is bedrock
selectModel.addEventListener("change", () => {
    statusIndicator.textContent = ""
    // conversationId = null;
    chatContainer.innerHTML = "";
    statusIndicator.style.margin = "0";
    selectedModel = selectModel.value;
    if(!selectedModel) {
        return;
    }
    createAndActivateNewChatItem(); // Create a new chat item for the selected model
    console.log("Selected Model", selectedModel)
    connectWebSocket()
    console.log("Conversation ID after model change:", conversationId);
});


async function getConversations(chatApiBase, tenantId, userId = "") {
    try {
        const url = new URL(`${chatApiBase}/conversations`);
        url.searchParams.append("tenant_id", tenantId);
        url.searchParams.append("user_id", userId);

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.conversations || [];
    } catch (error) {
        console.error("Error fetching conversations:", error.message);
        return [];
    }
}

// Render the sidebar
async function loadAndRenderConversations(chatApiBase, tenantId, userId = "") {
    const conversationList = document.querySelector(".conversation-list");
    conversationList.innerHTML = "";
    const conversations = await getConversations(chatApiBase, tenantId, userId);

    if (conversations.length === 0) {
        conversationList.innerHTML = "<p>No conversations found.</p>"; // when no conversations exists
        return;
    }

    conversations.forEach((conv) => {
        const item = document.createElement("div");
        item.className = "conversation-item";
        item.textContent = conv.conversation_id;

        item.addEventListener("click", () => {
            activateConversationItem(item, conv.conversation_id);
        });
        conversationList.appendChild(item);
    });

    if (conversations.length > 0) {
        const firstItem = conversationList.querySelector(".conversation-item");
        if (firstItem) {
            activateConversationItem(firstItem, conversations[0].conversation_id);
        }
    }
}

// function activateConversationItem(item, id) {
//     document.querySelectorAll('.conversation-item').forEach(ele => {
//         ele.classList.remove('active');
//     });

//     item.classList.add('active');
//     conversationId = id; // This can be null for new conversations
//     console.log("Conversation ID set to:", conversationId);

//     if (conversationId) {
//         chatContainer.innerHTML = '';
//         getSelectedConversationDetails(conversationId);
//         // console.log("Selected Conversation ID:", conversationId);
//     } else {
//         // New conversation - clear chat
//         chatContainer.innerHTML = '';
//         console.log("New conversation selected");
//     }
// }

function activateConversationItem(item, id) {
    // Remove active class from all items
    document.querySelectorAll(".conversation-item").forEach((ele) => {
        ele.classList.remove("active");
    });

    // Add active class to selected item
    item.classList.add("active");

    // Check if conversation ID is actually changing
    const previousConversationId = conversationId;
    const newConversationId = id;

    console.log("Previous Conversation ID:", previousConversationId);
    console.log("New Conversation ID:", newConversationId);

    // Only reconnect if conversation ID is different
    const shouldReconnect =
        previousConversationId !== newConversationId &&
        !(previousConversationId == null && newConversationId == null);
    if (shouldReconnect) {
        console.log("Conversation ID changed - reconnecting WebSocket");

        if (websocket && websocket.readyState === WebSocket.OPEN) {
            console.log("Disconnecting existing WebSocket");
            websocket.close(1000, "Switching conversation");
        }
        conversationId = newConversationId;
        console.log("Conversation ID set to:", conversationId);

        chatContainer.innerHTML = "";

        if (tenantId && userId) {
            console.log("Reconnecting WebSocket with new conversation ID");
            connectBtn.onclick();
        }

        // Load conversation details if it's an existing conversation
        if (conversationId) {
            getSelectedConversationDetails(conversationId);
        } else {
            console.log("New conversation selected");
        }
    } else {
        console.log("Same conversation selected - no reconnection needed");
        conversationId = newConversationId;

        if (conversationId) {
            chatContainer.innerHTML = "";
            getSelectedConversationDetails(conversationId);
        } else {
            chatContainer.innerHTML = "";
            console.log("New conversation selected");
        }
    }
}

function renderChatMessage(sender, message) {
    const messageDiv = document.createElement("p");
    messageDiv.classList.add(
        sender === "user" ? "user-message" : "chatbot-message"
    ); // render the chat messages of user and chatbot
    messageDiv.textContent = message;
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight; // Auto scroll to bottom
}

async function getSelectedConversationDetails(conversationId) {
    if (!conversationId) {
        console.log("No conversation ID provided - this is a new conversation");
        return;
    }
    const response = await SelectConversation(conversationId); // get previous chat history by passing conversation ID
    console.log(response.history);
    if (response && response.history && Array.isArray(response.history)) {
        const chatContainerElement = document.querySelector("chat-container");
        chatContainer.innerHTML = "";

        response.history.forEach((entry) => {
            renderChatMessage("user", entry.query);
            renderChatMessage("bot", entry.response);
        });
    }
}

// function createNewConversation() {
//     websocket.close(1000, "User disconnected");
//     console.log("Disconeected websocket", websocket);
//     conversationId = null;
//     console.log("Create new conversation function", conversationId);
//     const conversationList = document.querySelector(".conversation-list");
//     const newItem = document.createElement("div");
//     newItem.className = "conversation-item";
//     newItem.textContent = "New Chat"; // Temporary display text
//     const tempId = "new_" + Date.now(); // Temporary ID for UI purposes
//     newItem.dataset.tempId = tempId;

//     newItem.addEventListener("click", () => {
//         activateConversationItem(newItem, null); // Pass null for new conversation
//     });

//     conversationList.prepend(newItem);
//     activateConversationItem(newItem, null);
//     // startRecordBtn.disabled = true;
//     connectBtn.onclick();
// }

function createNewConversation() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close(1000, "User disconnected");
    }
    conversationId = null;
    const statusEl = document.getElementById("status-indicator");
    statusEl.style.display = "none"
    selectModel.selectedIndex = 0
    const conversationList = document.querySelector(".conversation-list");
    const newItem = document.createElement("div");
    newItem.className = "conversation-item";
    newItem.textContent = "New Chat";
    const tempId = "new_" + Date.now();
    newItem.dataset.tempId = tempId;
    document.getElementById("status-indicator-new").textContent = "Select the model to continue to the chat.";
    newItem.addEventListener("click", () => {
        activateConversationItem(newItem, null);
    });
    conversationList.prepend(newItem);
    activateConversationItem(newItem, null);
    chatSection.style.display = "none";
    statusIndicatortextContent = "Select the model to continue to the chat.";
    startRecordBtn.disabled = true;
    stopRecordBtn.disabled = true;
    // Do not connect WebSocket yet
}

// Get chat history
async function SelectConversation(conversationId) {
    try {
        const response = await fetch(
            `${CHAT_API_BASE}/conversation_history/${conversationId}`,
            {
                method: "Get",
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data || [];
    } catch (error) {
        console.log("Error fetching conversation history", error.message);
    }
}

// Chatbot functionalities
// Activate the send message whenever the user clicks send btn or press enter key.
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
    }
});

function addMessageToChat(message, sender = "user") {
    const p = document.createElement("p");
    p.textContent = message;
    p.className = sender === "user" ? "user-message" : "chatbot-message";
    chatContainer.appendChild(p);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Update the last message of the chat bot as it first display "..."
// When the frontend waits for the response from the backend
// Display the bots response message after processing it.
function updateLastChatbotMessage(message) {
    const messages = chatContainer.querySelectorAll(".chatbot-message");
    if (messages.length === 0) {
        addMessageToChat(message, "chatbot");
    } else {
        const lastMessage = messages[messages.length - 1];

        if (message.includes("<") && message.includes(">")) {
            lastMessage.innerHTML = message;
        } else {
            lastMessage.textContent = message;
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// Send the user's query to the bot and process the response from the backend
let message = "";
async function sendMessage() {
    message = chatInput.value.trim();
    if (!message) return;

    addMessageToChat(message, "user");

    // type: 'user_message',
    // ...(conversationId ? { conversation_id: conversationId } : {})

    // dynamic payload changes based the user's selected model. default one is bedrock
    const payload = {
        tenant_id: tenantId,
        user_id: userId,
        query: message,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        provider: selectedModel,
    };

    addMessageToChat("...", "chatbot");
    chatInput.value = "";

    try {
        const response = await fetch(`${CHAT_API_BASE}/conversation`, {
            // pass the user's query to the chatbot
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/plain, application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            let errorText = await response.text();
            try {
                const errorJson = JSON.parse(errorText);
                errorText = errorJson.message || errorText;
            } catch (e) { }
            updateLastChatbotMessage(`API error: ${response.status} - ${errorText}`);
            return;
        }

        // stream the response
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let chatResponse = "";
        let hasReceivedContent = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    try {
                        const data = JSON.parse(trimmedLine);
                        console.log(data);
                        if (data.type === "content") {
                            const content = data.content || "";
                            chatResponse += content;
                            updateLastChatbotMessage(chatResponse);
                            hasReceivedContent = true;
                        } else if (data.type === "metadata") {
                            if (data.status === "success" && data.conversation_id) {
                                // Handle new conversation ID from backend
                                if (
                                    !conversationId ||
                                    conversationId !== data.conversation_id
                                ) {
                                    // Update the conversation ID
                                    conversationId = data.conversation_id;

                                    // Update the active conversation item
                                    const activeItem = document.querySelector(
                                        ".conversation-item.active"
                                    );
                                    if (activeItem) {
                                        activeItem.textContent = conversationId;
                                        activeItem.removeAttribute("data-temp-id");

                                        // Update click handler with real ID
                                        activeItem.removeEventListener(
                                            "click",
                                            activeItem.clickHandler
                                        );
                                        activeItem.clickHandler = () => {
                                            activateConversationItem(activeItem, conversationId);
                                        };
                                        activeItem.addEventListener(
                                            "click",
                                            activeItem.clickHandler
                                        );
                                    }

                                    // console.log('Conversation ID updated from server:', conversationId);
                                }
                            }
                            if (data.status === "error") {
                                updateLastChatbotMessage(
                                    `Server metadata error: ${data.message || "Unknown error"}`
                                );
                                return;
                            }
                        } else if (data.type === "error") {
                            updateLastChatbotMessage(
                                `Error from server: ${data.message || "Unknown error occurred"}`
                            );
                            return;
                        }
                    } catch (parseError) {
                        console.warn(
                            "Failed to parse JSON chunk:",
                            trimmedLine,
                            parseError
                        );
                    }
                }
            }

            if (buffer.trim()) {
                try {
                    const data = JSON.parse(buffer.trim());
                    if (data.type === "content") {
                        chatResponse += data.content || "";
                        updateLastChatbotMessage(chatResponse);
                        hasReceivedContent = true;
                    }
                } catch (parseError) {
                    console.warn("Failed to parse leftover buffer:", buffer, parseError);
                }
            }

            if (!hasReceivedContent && chatResponse === "") {
                updateLastChatbotMessage("No content received from the server.");
            }
        } catch (streamError) {
            console.error("Stream reading error:", streamError);
            updateLastChatbotMessage(`Stream error: ${streamError.message}`);
        } finally {
            try {
                reader.releaseLock();
            } catch (e) { }
        }
    } catch (networkError) {
        console.error("Network error during fetch:", networkError);
        updateLastChatbotMessage(`Network error: ${networkError.message}`);
    }
}

refreshBtn.onclick = async () => {
    const response = await loadAndRenderConversations(
        CHAT_API_BASE,
        tenantId,
        userId
    );
};

function goToLogin() {
    disconnect();
    mainContainer.style.display = "none";
    loginContainer.style.display = "block";
    const status = document.querySelector(".upload-status");
    if (status) {
        status.querySelectorAll("p").forEach((p) => p.remove());
    }
}

// Change the tenant id
const changeTenantButton = document.querySelector(".ChangeTenantButton");
changeTenantButton.addEventListener("click", () => {
    goToLogin();
    const status = document.querySelector(".upload-status");
    if (status) {
        status.querySelectorAll("p").forEach((p) => p.remove());
    }
    const statusEl = document.getElementById("status-indicator");
    statusEl.style.display = "none"
    conversationId = null;
    chatContainer.innerHTML = "";
});

// upload document
document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("uploadDocument");
    const dropZone = document.querySelector(".upload-box");
    const status = document.querySelector(".upload-status");

    // Handle both change (click to upload) and drop
    const handleFileUpload = async (file) => {
        if (!file) return;

        // Clear status and create a new message
        status.innerHTML = "";
        const statusMessage = document.createElement("p");
        statusMessage.style.background = "green";
        statusMessage.style.color = "white";
        statusMessage.style.padding = "6px 12px";
        statusMessage.textContent = "Uploading...";
        status.appendChild(statusMessage);

        const allowedExtensions = [".pdf", ".docx", ".txt"];
        const fileExt = file.name
            .slice(((file.name.lastIndexOf(".") - 1) >>> 0) + 2)
            .toLowerCase();

        if (!allowedExtensions.includes(`.${fileExt}`)) {
            statusMessage.textContent =
                "❌ Only PDF, DOCX, and TXT files are supported.";
            statusMessage.style.background = "red";
            return;
        }

        try {
            // 1. Get presigned URL
            const urlResponse = await fetch(
                `${UPLOAD_API_BASE}/generate-presigned-url`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Accept: "application/json",
                    },
                    body: new URLSearchParams({
                        filename: file.name,
                        tenant_id: tenantId,
                    }),
                }
            );

            if (!urlResponse.ok) throw new Error("Failed to get presigned URL");

            const { presigned_url, s3_key, file_id } = await urlResponse.json();
            console.log(
                "presigned url, s3 key and file id",
                presigned_url,
                s3_key,
                file_id
            );
            if (!presigned_url || !s3_key || !file_id)
                throw new Error("Invalid presigned URL response");

            // 2. Upload file
            const contentType =
                {
                    pdf: "application/pdf",
                    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    txt: "text/plain",
                }[fileExt] || "application/octet-stream";

            const uploadResult = await fetch(presigned_url, {
                method: "PUT",
                headers: { "Content-Type": contentType },
                body: file,
            });

            if (![200, 204].includes(uploadResult.status)) {
                throw new Error(`Upload failed with status ${uploadResult.status}`);
            }

            // 3. Process the file
            const processRes = await fetch(`${UPLOAD_API_BASE}/process-file`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
                body: new URLSearchParams({
                    s3_key: s3_key,
                    tenant_id: tenantId,
                    file_id: file_id,
                }),
            });

            if (!processRes.ok) throw new Error("Failed to process file");

            const processResult = await processRes.json();
            if (processResult) {
                setTimeout(() => {
                    statusMessage.textContent = `File processed successfully: ${file.name}`;
                    setTimeout(() => {
                        status.innerHTML = ""; // Auto-clear message after 5s
                    }, 5000);
                }, 40000);
            }

            // Show chatbot response
            if (processResult && processResult.response) {
                renderChatMessage("bot", processResult.response);
            }
        } catch (error) {
            console.error("Upload error:", error);
            statusMessage.textContent = `❌ ${error.message}`;
            statusMessage.style.backgroundColor = "red";
            statusMessage.style.color = "white";
        }
        fileInput.value = "";
    };

    // Click upload
    fileInput.addEventListener("change", (e) => {
        handleFileUpload(e.target.files[0]);
    });

    // FIXED: Prevent default on ALL drag events
    dropZone.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.border = "2px dashed #10b981";
        dropZone.style.backgroundColor = "#f0fff4";
    });

    dropZone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.border = "";
        dropZone.style.backgroundColor = "";
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.border = "";
        dropZone.style.backgroundColor = "";

        const file = e.dataTransfer.files[0];
        console.log("File dropped:", file);
        handleFileUpload(file);
    });

    // ADDITIONAL FIX: Also prevent default on document level
    document.addEventListener("dragover", (e) => {
        e.preventDefault();
    });

    document.addEventListener("drop", (e) => {
        e.preventDefault();
    });
});

function setStatusMessage(msg) {
    const statusEl = document.getElementById("status-indicator");
    if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.display = "block";
    }
}

function clearStatusMessage() {
    const statusEl = document.getElementById("status-indicator");
    if (statusEl) {
        statusEl.textContent = "";
        statusEl.style.display = "none";
    }
}

// Initialize WebSocket connection
let tenantId, userId;
connectBtn.onclick = async () => {
    tenantId = tenantIdInput.value.trim();
    userId = userIdInput.value.trim();
    if (!tenantId || !userId) {
        alert("Tenant ID and User ID are required.");
        return;
    }
    // Only load conversations, do not connect WebSocket
    loginContainer.style.display = "none";
    mainContainer.style.display = "flex";
    chatSection.style.display = "none"; // Hide chat
    document.getElementById("status-indicator-new").textContent = "Select the model to continue to the chat.";
    // connectBtn.disabled = true;
    // disconnectBtn.disabled = false;
    // startRecordBtn.disabled = true;
    // stopRecordBtn.disabled = true;
};

async function connectWebSocket() {
    // Only connect if not already connected
    if (websocket && websocket.readyState === WebSocket.OPEN) return;
    await loadAndRenderConversations(CHAT_API_BASE, tenantId, userId);
    setTimeout( () => {
        refreshBtn.click(); // Refresh conversations after loading
    }, 200);
    chatSection.style.display = "block";
    // ...copy your existing connectBtn.onclick WebSocket code here, but without the conversation list loading...
    const payload = {
        tenant_id: tenantId,
        user_id: userId,
        query: message || "",
        ...(conversationId ? { conversation_id: conversationId } : {}),
    };
    const provider = selectedModel
    // const baseUrl = "ws://doppelio-goml-ecs-alb-1845578001.us-west-2.elb.amazonaws.com";
    const baseUrl = "http://localhost:8005"
    let url = `${baseUrl}/ws/speech?tenant_id=${encodeURIComponent(tenantId)}&user_id=${encodeURIComponent(userId)}&provider=${encodeURIComponent(provider)}`;
    websocket = new WebSocket(url);
    connectBtn.textContent = "Connecting...";
    websocket.onopen = async () => {
        connectBtn.textContent = "Connected";
        chatContainer.style.display = "flex";
        document.getElementById("status-indicator-new").textContent = "";
        // websocket.send(JSON.stringify(payload));
        startRecordBtn.disabled = false;
    };
    // ...rest of your websocket event handlers...
    websocket.onmessage = (event) => {
        if (expectAudio && event.data instanceof Blob) {
            logMessage(
                `[Audio] Received audio blob of size: ${event.data.size} bytes for chat_id: ${currentChatId}`,
                "info"
            );
            const audioUrl = URL.createObjectURL(event.data);
            audioPlayback.src = audioUrl;
            audioPlayback
                .play()
                .catch((e) => logMessage(`Error playing audio: ${e}`, "error"));
            audioPlayback.onended = () => {
                URL.revokeObjectURL(audioUrl);
                logMessage("[Audio] Playback finished.", "info");
            };
            expectAudio = false; // Reset flag
            return;
        }

        // Check if the data is a Blob and expected as audio
        if (expectAudio && event.data instanceof Blob) {
            logMessage(
                `[Audio] Received audio blob of size: ${event.data.size} bytes for chat_id: ${currentChatId}`,
                "info"
            );
            const audioUrl = URL.createObjectURL(event.data);
            audioPlayback.src = audioUrl;
            audioPlayback
                .play()
                .catch((e) => logMessage(`Error playing audio: ${e}`, "error"));
            audioPlayback.onended = () => {
                URL.revokeObjectURL(audioUrl);
                logMessage("[Audio] Playback finished.", "info");
            };
            expectAudio = false;
            return;
        }

        // Skip JSON parsing for non-string data
        if (typeof event.data !== "string") {
            logMessage(
                `Received unexpected non-string message of type: ${Object.prototype.toString.call(
                    event.data
                )}`,
                "error"
            );
            return;
        }

        let data;
        try {
            data = JSON.parse(event.data);
            console.log("Speech to response data", data); // Update conversation ID if provided
            logMessage(data, "server");
        } catch (e) {
            logMessage(
                `Error parsing JSON: ${e.message}. Data: ${event.data}`,
                "error"
            );
            return;
        }

        currentChatId = data.chat_id || currentChatId; // Persist chat_id for audio correlation
        let lastUserMessage = null;
        switch (data.type) {
            case "connection_established":
                // statusEl.textContent = `Connected. Conversation ID: ${data.conversation_id}`;
                conversationId = data.conversation_id; // Update UI if server assigned one
                console.log(
                    "Connection established with conversation ID:",
                    conversationId
                );
                logMessage(
                    `Server: ${data.message} (Conv ID: ${data.conversation_id})`,
                    "info"
                );
                const activeItem = document.querySelector(".conversation-item.active");
                if (activeItem) {
                    activeItem.textContent = conversationId;
                    activeItem.removeAttribute("data-temp-id");

                    // Update click handler with real ID
                    activeItem.removeEventListener("click", activeItem.clickHandler);
                    activeItem.clickHandler = () => {
                        activateConversationItem(activeItem, conversationId);
                    };
                    activeItem.addEventListener("click", activeItem.clickHandler);
                }
                break;
            case "status_update":
                logMessage(
                    `Status (${data.chat_id || "N/A"}): ${data.status}`,
                    "status-update"
                );
                if (
                    data.status === "ready_for_next" ||
                    data.status === "processing_audio_failed"
                ) {
                    // Potentially re-enable recording here if needed after an error or completion
                }
                break;
            case "interim_transcript":
                lastUserMessage = addMessageToChat(data.transcript, "user");
                clearStatusMessage();
                logMessage(
                    `Interim Transcript (${data.chat_id}): ${data.transcript}`,
                    "server"
                );
                break;
            case "final_text_response":
                if (lastUserMessage) {
                    updateLastChatbotMessage(data.text);
                    if (!conversationId || conversationId !== data.conversation_id) {
                        // Update the conversation ID
                        conversationId = data.conversation_id;

                        // Update the active conversation item
                        const activeItem = document.querySelector(
                            ".conversation-item.active"
                        );
                        if (activeItem) {
                            activeItem.textContent = conversationId;
                            activeItem.removeAttribute("data-temp-id");

                            // Update click handler with real ID
                            activeItem.removeEventListener("click", activeItem.clickHandler);
                            activeItem.clickHandler = () => {
                                activateConversationItem(activeItem, conversationId);
                            };
                            activeItem.addEventListener("click", activeItem.clickHandler);
                        }

                        console.log("Conversation ID updated from server:", conversationId);
                    }
                } else addMessageToChat(data.text, "bot");
                logMessage(`AI Response (${data.chat_id}): ${data.text}`, "server");
                break;
            case "audio_response_start": // Server signals audio data is next
                logMessage(
                    `[Audio] Server preparing to send audio for chat_id: ${data.chat_id}. Content-type: ${data.content_type}`,
                    "info"
                );
                expectAudio = true;
                break;
            case "error":
                logMessage(
                    `Error (${data.chat_id || "N/A"}): ${data.message}`,
                    "error"
                );
                console.log(
                    `Error (${data.chat_id || "N/A"}): ${data.message}`,
                    "error"
                );
                break;
            case "info":
                updateLastChatbotMessage(data.message);
                clearStatusMessage();
                logMessage(`Info (${data.chat_id || "N/A"}): ${data.message}`, "info");
                break;
            case "session_end":
                logMessage(
                    `Session Ended (${data.chat_id || "N/A"}): ${data.message}`,
                    "info"
                );
                disconnect(); // Or handle differently
                break;
            default:
                logMessage(`Unknown message type: ${data.type}`, "error");
        }
    };

    websocket.onclose = (event) => {
        // statusEl.textContent = `Disconnected: ${event.reason || 'No reason specified'} (Code: ${event.code})`;
        logMessage(
            `WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || "N/A"
            }`,
            "info"
        );
        connectBtn.disabled = false;
        // disconnectBtn.disabled = true;
        // startRecordBtn.disabled = true; 12/6
        stopRecordBtn.disabled = true;
        if (isRecording) stopRecording(); // Clean up recording state
        // websocket = null;
    };

    websocket.onerror = (error) => {
        logMessage(
            `WebSocket error: ${JSON.stringify(error, ["message", "name", "type"])}`,
            "error"
        );
        // disconnectBtn may or may not be enabled depending on state
    };
}

disconnectBtn.onclick = () => {
    disconnect();
    console.log("Disconnecting WebSocket");
    loginContainer.style.display = "block";
    mainContainer.style.display = "none";
    tenantIdInput.value = "";
    userIdInput.value = "";
};

function disconnect() {
    if (websocket) {
        websocket.close(1000, "User disconnected");
    }
    if (isRecording) {
        stopRecording();
    }
    const statusEl = document.getElementById("status-indicator");
    statusEl.style.display = "none"
    connectBtn.disabled = false;
    // disconnectBtn.disabled = true;
    // startRecordBtn.disabled = true;
    stopRecordBtn.disabled = true;
    connectBtn.textContent = "Connect";
    const conversationList = document.querySelector(".conversation-list");
    if (conversationList) conversationList.innerHTML = "";
    selectModel.selectedIndex = 0;
    chatContainer.innerHTML = "";
}

startRecordBtn.onclick = async () => {

    console.log("recording websocket", websocket);
    console.log("conversationId", conversationId);
    audioBuffer = []; // Reset audio buffer
    console.log("Audio buffer reset", audioBuffer);
    try {
        logMessage("Attempting to start recording...", "info");
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: TARGET_SAMPLE_RATE, // Request 16kHz
                channelCount: 1,
                // echoCancellation: true // Optional
            },
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: TARGET_SAMPLE_RATE, // Try to force context to 16kHz
        });

        // Check actual sample rate
        let actualSampleRate = audioContext.sampleRate;
        logMessage(
            `AudioContext initialized. Requested SR: ${TARGET_SAMPLE_RATE}, Actual SR: ${actualSampleRate}. The server expects ${TARGET_SAMPLE_RATE}Hz.`,
            "info"
        );
        if (actualSampleRate !== TARGET_SAMPLE_RATE) {
            logMessage(
                `Warning: Actual sample rate (${actualSampleRate}Hz) differs from target (${TARGET_SAMPLE_RATE}Hz). Audio might be pitched.`,
                "error"
            );
        }

        const source = audioContext.createMediaStreamSource(mediaStream);
        // Buffer size, input channels, output channels
        // A buffer size of 0 means the browser picks the best buffer size
        // For 16kHz, 4096 samples is ~256ms.
        const bufferSize = 4096;
        scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

        scriptProcessor.onaudioprocess = (e) => {
            if (!isRecording) return;
            // The inputBuffer contains Float32Array data, ranging from -1.0 to 1.0
            const inputData = e.inputBuffer.getChannelData(0);
            // Convert to 16-bit PCM
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            audioBuffer.push(pcmData);
        };

        source.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination); // Connect to output to keep process running

        isRecording = true;
        // startRecordBtn.disabled = true;
        stopRecordBtn.disabled = false;
        setStatusMessage("Status: Recording...", "bot");
        // recordingStatusEl.textContent = 'Status: Recording...';
        logMessage("Recording started.", "info");
    } catch (err) {
        logMessage(
            `Error starting recording: ${err.name} - ${err.message}`,
            "error"
        );
        isRecording = false; // Ensure isRecording is false
        startRecordBtn.disabled = false; // Re-enable start if it failed
        stopRecordBtn.disabled = true;
    }
};

stopRecordBtn.onclick = () => {
    stopRecording();
};

function stopRecording() {
    if (!isRecording) return;
    isRecording = false; // Set this first to stop onaudioprocess from adding more
    setStatusMessage("Stopping recording...");
    logMessage("Stopping recording...", "info");
    console.log("Audio buffer", audioBuffer);
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        console.log("Audio media stream", mediaStream);
        mediaStream = null;
    }
    if (audioContext) {
        audioContext
            .close()
            .catch((e) => console.warn("Error closing AudioContext:", e));
        audioContext = null;
    }

    startRecordBtn.disabled = false;
    stopRecordBtn.disabled = true;
    setStatusMessage("Processing audio...");

    if (audioBuffer.length > 0) {

        const totalLength = audioBuffer.reduce((acc, val) => acc + val.length, 0);
        const concatenatedPCM = new Int16Array(totalLength);
        let offset = 0;
        for (const buffer of audioBuffer) {
            concatenatedPCM.set(buffer, offset);
            offset += buffer.length;
        }
        audioBuffer = []; // Clear buffer

        if (websocket && websocket.readyState === WebSocket.OPEN) {
            // Send as ArrayBuffer (raw bytes)
            logMessage(
                `Sending ${concatenatedPCM.buffer.byteLength} bytes of PCM audio data.`,
                "info"
            );
            websocket.send(concatenatedPCM.buffer);
            console.log("You (audio sent to server)")
            logMessage("You (audio sent to server)", "user");
        } else {
            logMessage("WebSocket not open. Cannot send audio.", "error");
        }
    } else {
        logMessage("No audio data recorded to send.", "info");
    }
    setStatusMessage("Audio processing...");
}

// Graceful disconnect on page unload
window.addEventListener("beforeunload", () => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        // May not always successfully send before page unloads
        websocket.close(1001, "Page unloading");
    }
});
