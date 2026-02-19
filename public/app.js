const API_URL = '/api';

// State
let currentUser = null;
let token = localStorage.getItem('token');
let activeChat = null;
let pollingInterval = null;
let lastMsgCount = 0;
let replyingTo = null; // { id, sender, content }
let currentTheme = localStorage.getItem('theme') || 'dark';

// DOM Elements
const authContainer = document.getElementById('auth-container');
const dashboardContainer = document.getElementById('dashboard-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authMessage = document.getElementById('auth-message');
const mfaSetupContainer = document.getElementById('mfa-setup-container');
const adminPanel = document.getElementById('admin-panel');

// Sound
const notificationSound = new Audio('https://raw.githubusercontent.com/xiol/notifications-sounds/refs/heads/master/src/notification-sounds/piece-of-cake-611.mp3');

// Toast Container
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
document.body.appendChild(toastContainer);

// Emoji list
const EMOJI_LIST = ['😀','😂','😍','🥰','😎','🤣','😊','🙏','👍','👎','❤️','🔥','🎉','💯','👏','😢','😡','🤔','😱','🥳','✨','💪','🙌','🤝','👀','💀','😈','🫡','🤗','😴'];
const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

// Apply theme
applyTheme(currentTheme);

// Init
if (token) {
    validateToken();
} else {
    showAuth();
}

// ============ AUTH ============
tabLogin.addEventListener('click', () => {
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
});

tabRegister.addEventListener('click', () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'flex';
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const mfaToken = document.getElementById('login-mfa').value;

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, mfaToken })
        });
        const data = await res.json();

        if (res.ok) {
            token = data.token;
            localStorage.setItem('token', token);
            currentUser = data.user;
            showDashboard();
        } else if (res.status === 403 && data.mfaRequired) {
            document.getElementById('mfa-input-group').style.display = 'block';
            authMessage.textContent = 'MFA Code required';
        } else {
            authMessage.textContent = data.error;
        }
    } catch (err) {
        authMessage.textContent = 'Connection error. Please try again.';
    }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;

    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
            token = data.token;
            localStorage.setItem('token', token);
            currentUser = { id: data.userId, username, role: data.role };
            authContainer.style.display = 'none';
            setupMFA();
        } else {
            authMessage.textContent = data.error;
        }
    } catch (err) {
        authMessage.textContent = 'Connection error. Please try again.';
    }
});

// MFA Setup
async function setupMFA() {
    mfaSetupContainer.style.display = 'flex';
    try {
        const res = await fetch(`${API_URL}/auth/mfa/setup`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        document.getElementById('qrcode-container').innerHTML = `<img src="${data.imageUrl}" alt="MFA QR Code" style="border-radius: 12px;">`;
    } catch (err) {
        console.error('MFA setup error:', err);
    }
}

document.getElementById('mfa-verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tokenInput = document.getElementById('verify-token').value;
    const res = await fetch(`${API_URL}/auth/mfa/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token: tokenInput })
    });

    if (res.ok) {
        mfaSetupContainer.style.display = 'none';
        showDashboard();
    } else {
        showToast('Error', 'Invalid MFA Token');
    }
});

document.getElementById('skip-mfa').addEventListener('click', () => {
    mfaSetupContainer.style.display = 'none';
    showDashboard();
});

async function validateToken() {
    try {
        const res = await fetch(`${API_URL}/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            currentUser = await res.json();
            if (currentUser.theme) {
                currentTheme = currentUser.theme;
                applyTheme(currentTheme);
            }
            showDashboard();
        } else {
            logout();
        }
    } catch (err) {
        logout();
    }
}

async function logout() {
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {}
    token = null;
    localStorage.removeItem('token');
    currentUser = null;
    clearInterval(pollingInterval);
    showAuth();
}

function showAuth() {
    authContainer.style.display = 'flex';
    dashboardContainer.style.display = 'none';
    mfaSetupContainer.style.display = 'none';
    authMessage.textContent = '';
}

// ============ DASHBOARD ============
function showDashboard() {
    authContainer.style.display = 'none';
    dashboardContainer.style.display = 'flex';
    document.getElementById('current-username').textContent = currentUser.username;
    setAvatar('my-avatar', currentUser.username);

    if (currentUser.role === 'admin') {
        document.getElementById('admin-btn').style.display = 'flex';
        document.getElementById('admin-role-filter').style.display = 'block';
    }

    // Profile click
    document.querySelector('.user-profile').onclick = openProfileSettings;

    // Request Notification Permission
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    loadChats();

    // Polling
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
        sendHeartbeat();
        loadChats();
        checkGameInvites();
        checkActiveGames();
        if (activeChat) {
            loadMessages(true);
            checkTypingStatus();
        }
        updateUnreadTitle();
    }, 3000);
}

document.getElementById('logout-btn').addEventListener('click', logout);

// Heartbeat
async function sendHeartbeat() {
    try {
        await fetch(`${API_URL}/users/heartbeat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {}
}

// ============ SEARCH ============
window.performSearch = async () => {
    const q = document.getElementById('user-search').value;
    const online = document.getElementById('filter-online').value;
    const role = document.getElementById('filter-role').value;
    
    if (!q && online === 'any' && !role) {
        document.getElementById('search-results').style.display = 'none';
        return;
    }

    let url = `${API_URL}/users/search?q=${q}`;
    if (online !== 'any') url += `&online=${online}`;
    if (role) url += `&role=${role}`;

    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const users = await res.json();
    const results = document.getElementById('search-results');
    results.style.display = 'block';

    if (users.length === 0) {
        results.innerHTML = '<div style="padding:1rem; color: var(--text-muted); text-align:center;">No matching users found</div>';
    } else {
        results.innerHTML = users.map(u => `
            <div class="search-item">
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                    <div class="avatar" style="width:30px; height:30px; font-size:0.75rem; background:${u.avatar_color || getAvatarColor(u.username)}">
                        ${u.username[0].toUpperCase()}
                        ${u.is_online ? '<span class="online-dot"></span>' : ''}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <span style="font-size:0.85rem; font-weight:500;">${u.username}</span>
                        ${u.role === 'admin' ? '<span class="role-badge admin" style="font-size:0.6rem; width:fit-content; padding:0 4px;">ADMIN</span>' : ''}
                    </div>
                </div>
                <button class="btn-xs" style="padding: 2px 8px;" onclick="sendFriendRequest(${u.id})">Add</button>
            </div>
        `).join('');
    }
}

document.getElementById('search-filter-btn').onclick = () => {
    const panel = document.getElementById('search-filters-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

window.clearSearchFilters = () => {
    document.getElementById('filter-online').value = 'any';
    document.getElementById('filter-role').value = '';
    document.getElementById('user-search').value = '';
    performSearch();
};

// Auto-search on typing (debounce)
let searchTimeout;
document.getElementById('user-search').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 400);
});

// Hide results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box') && !e.target.closest('#search-filters-panel')) {
        document.getElementById('search-results').style.display = 'none';
    }
});

window.sendFriendRequest = async (id) => {
    const res = await fetch(`${API_URL}/users/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ targetUserId: id })
    });
    const data = await res.json();
    showToast('Friends', data.message || data.error);
    document.getElementById('search-results').style.display = 'none';
};

// ============ CHAT LOADING ============
async function loadChats() {
    try {
        const [resFriends, resGroups] = await Promise.all([
            fetch(`${API_URL}/users/friends`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${API_URL}/groups`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        const friends = await resFriends.json();
        const groups = await resGroups.json();

        const chatList = document.getElementById('chat-list');
        const friendList = document.getElementById('friend-list');
        const groupList = document.getElementById('group-list');

        const pendingFriends = friends.filter(f => f.status === 'pending');
        const acceptedFriends = friends.filter(f => f.status === 'accepted');

        // Total unread counter
        let totalUnread = 0;
        acceptedFriends.forEach(f => { totalUnread += parseInt(f.unread_count || 0); });

        // Pending Requests
        friendList.innerHTML = pendingFriends.map(f => {
            if (f.user2_id === currentUser.id) {
                return `<li>
                    <div class="chat-item-container">
                        <div class="avatar" style="width:36px; height:36px; font-size:0.85rem; background:${getAvatarColor(f.username)}">${f.username[0].toUpperCase()}</div>
                        <div class="chat-info">
                            <div class="chat-name">${f.username}</div>
                        </div>
                        <button class="btn-small" onclick="acceptFriend(${f.friendship_id}, event)">Accept</button>
                    </div>
                </li>`;
            } else {
                return `<li style="opacity:0.6;">
                    <div class="chat-item-container">
                        <div class="avatar" style="width:36px; height:36px; font-size:0.85rem; background:${getAvatarColor(f.username)}">${f.username[0].toUpperCase()}</div>
                        <div class="chat-info"><div class="chat-name">${f.username} <span style="color:var(--text-muted); font-size:0.8em;">(Pending)</span></div></div>
                    </div>
                </li>`;
            }
        }).join('');

        // Active Chats (Friends)
        chatList.innerHTML = acceptedFriends.map(f => {
            const time = f.last_message_time ? new Date(f.last_message_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
            const isActive = activeChat && activeChat.type === 'user' && activeChat.id === f.id;
            const onlineClass = f.is_online ? 'online-indicator' : '';
            return `<li onclick="openChat('user', ${f.id}, '${f.username}')" class="chat-item-container ${isActive ? 'active' : ''}">
                <div class="avatar" style="background:${f.avatar_color || getAvatarColor(f.username)}">
                    ${f.username[0].toUpperCase()}
                    ${f.is_online ? '<span class="online-dot"></span>' : ''}
                </div>
                <div class="chat-info">
                    <div class="top-row">
                        <div class="chat-name">${f.username}</div>
                        <span class="chat-time">${time}</span>
                    </div>
                    <div class="bottom-row">
                        <div class="chat-preview">${f.last_message || 'Start a conversation'}</div>
                        ${parseInt(f.unread_count) > 0 ? `<span class="badge">${f.unread_count}</span>` : ''}
                    </div>
                </div>
            </li>`;
        }).join('');

        // Groups
        groupList.innerHTML = groups.map(g => {
            if (g.status === 'invited') {
                return `<li style="cursor:default; background: var(--accent-subtle); border-left: 3px solid var(--warning);">
                    <div class="chat-item-container" style="align-items:flex-start;">
                        <div class="avatar" style="background:var(--warning)">✉️</div>
                        <div class="chat-info">
                            <div class="chat-name">${g.name} <span style="font-size:0.75em; color:var(--warning)">(Invited)</span></div>
                            <div style="display:flex; gap:8px; margin-top:6px;">
                                <button class="btn-small" onclick="respondToInvite(${g.id}, 'accept')">Accept</button>
                                <button class="btn-small" style="background:var(--danger);" onclick="respondToInvite(${g.id}, 'reject')">Decline</button>
                            </div>
                        </div>
                    </div>
                </li>`;
            }
            if (g.status === 'pending') {
                return `<li style="opacity:0.5; cursor:default;">
                    <div class="chat-item-container">
                        <div class="avatar" style="background:var(--bg-hover)">#</div>
                        <div class="chat-info"><div class="chat-name">${g.name} <span style="color:var(--text-muted); font-size:0.8em;">(Pending)</span></div></div>
                    </div>
                </li>`;
            }
            const isActive = activeChat && activeChat.type === 'group' && activeChat.id === g.id;
            return `<li onclick="openChat('group', ${g.id}, '${g.name}')" class="chat-item-container ${isActive ? 'active' : ''}">
                <div class="avatar" style="background:${getAvatarColor(g.name)}">#</div>
                <div class="chat-info">
                    <div class="chat-name">${g.name}</div>
                </div>
            </li>`;
        }).join('');

    } catch (err) {
        console.error('Error loading chats:', err);
    }
}

window.acceptFriend = async (friendshipId, event) => {
    if (event) event.stopPropagation();
    await fetch(`${API_URL}/users/friends/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ friendshipId })
    });
    showToast('Friends', 'Friend request accepted! 🎉');
    loadChats();
};

window.respondToInvite = async (groupId, action) => {
    const endpoint = action === 'accept' ? 'accept' : 'reject';
    await fetch(`${API_URL}/groups/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ groupId })
    });
    showToast('Groups', action === 'accept' ? 'Welcome to the group! 🎉' : 'Invitation declined');
    loadChats();
};

// ============ CREATE GROUP ============
document.getElementById('create-group-btn').onclick = () => {
    document.getElementById('modal-overlay').style.display = 'flex';
};

document.getElementById('cancel-modal').onclick = () => {
    document.getElementById('modal-overlay').style.display = 'none';
};

document.getElementById('confirm-create-group').onclick = async () => {
    const name = document.getElementById('new-group-name').value;
    if (!name) return;
    await fetch(`${API_URL}/groups/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name })
    });
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('new-group-name').value = '';
    showToast('Groups', `Group "${name}" created! 🎉`);
    loadChats();
};

// ============ OPEN CHAT ============
window.openChat = async (type, id, name) => {
    activeChat = { type, id, name };
    replyingTo = null;
    hideReplyBar();

    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-title').textContent = name;
    
    // Find color if user
    let color = null;
    if (type === 'user') {
        const friendElement = Array.from(document.querySelectorAll('#chat-list li.chat-item-container')).find(li => {
            const avatar = li.querySelector('.avatar');
            return avatar && avatar.style.background;
        });
        // We can just get it from the data if we had it in a better way, 
        // but for now let's try to find the active item's color.
        const activeItem = document.querySelector('#chat-list li.active .avatar');
        if (activeItem) color = activeItem.style.background;
    }

    setAvatar('chat-avatar', name, color);
    document.getElementById('chat-input-form').style.display = 'flex';

    // For mobile
    document.getElementById('main-chat-area').classList.add('open');
    document.getElementById('back-btn').style.display = 'flex';

    // Group Info Button
    const groupInfoBtn = document.getElementById('group-info-btn');
    if (type === 'group') {
        groupInfoBtn.style.display = 'flex';
        groupInfoBtn.onclick = () => showGroupInfo(id, name);
        document.getElementById('chat-subtitle').textContent = 'tap ℹ️ for group info';
    } else {
        groupInfoBtn.style.display = 'none';
        // Show online status
        updateChatSubtitle(id);
    }

    // Mark as read
    if (type === 'user') {
        await markAsRead(id);
    }

    loadMessages();
    loadChats();
};

async function updateChatSubtitle(userId) {
    try {
        const res = await fetch(`${API_URL}/users/friends`, { headers: { 'Authorization': `Bearer ${token}` } });
        const friends = await res.json();
        const friend = friends.find(f => f.id === userId);
        if (friend) {
            if (friend.is_online) {
                document.getElementById('chat-subtitle').textContent = '🟢 Online';
            } else if (friend.last_seen) {
                const lastSeen = new Date(friend.last_seen);
                document.getElementById('chat-subtitle').textContent = `Last seen ${formatLastSeen(lastSeen)}`;
            }
        }
    } catch (e) {}
}

function formatLastSeen(date) {
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return date.toLocaleDateString();
}

// Mobile Back Button
document.getElementById('back-btn').onclick = () => {
    document.getElementById('main-chat-area').classList.remove('open');
    activeChat = null;
    loadChats();
};

async function markAsRead(senderId) {
    await fetch(`${API_URL}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ senderId })
    });
}

// ============ MESSAGES ============
async function loadMessages(isPoll = false) {
    if (!activeChat) return;
    const query = activeChat.type === 'group' ? `groupId=${activeChat.id}` : `userId=${activeChat.id}`;
    
    try {
        const res = await fetch(`${API_URL}/messages?${query}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const messages = await res.json();

        const container = document.getElementById('chat-messages');

        // Notification logic
        if (isPoll && messages.length > lastMsgCount && document.hidden) {
            playSound();
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.sender !== currentUser.username) {
                showBrowserNotification(`New message from ${lastMsg.sender}`, lastMsg.content);
            }
        }
        if (!isPoll) lastMsgCount = messages.length;
        else if (messages.length > lastMsgCount) {
            lastMsgCount = messages.length;
            playSound();
        }

        const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        if (messages.length === 0) {
            container.innerHTML = `<div class="placeholder"><div class="placeholder-content"><div class="placeholder-icon">💬</div><p style="color:var(--text-muted)">No messages yet. Say hello!</p></div></div>`;
        } else {
            // Group messages by date
            let html = '';
            let lastDate = '';
            
            messages.forEach(m => {
                const msgDate = new Date(m.timestamp).toLocaleDateString();
                if (msgDate !== lastDate) {
                    lastDate = msgDate;
                    html += `<div class="date-separator"><span>${formatDateLabel(m.timestamp)}</span></div>`;
                }

                const isMe = m.sender === currentUser.username;
                const ticks = isMe ? `<span class="ticks ${m.is_read ? 'read' : ''}">${m.is_read ? '✓✓' : '✓'}</span>` : '';
                const time = new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                // Reactions
                let reactionsHtml = '';
                if (m.reactions && m.reactions !== '[]' && Array.isArray(m.reactions) && m.reactions.length > 0) {
                    const grouped = {};
                    m.reactions.forEach(r => {
                        if (!grouped[r.emoji]) grouped[r.emoji] = [];
                        grouped[r.emoji].push(r.username);
                    });
                    reactionsHtml = `<div class="reactions-bar">` +
                        Object.entries(grouped).map(([emoji, users]) =>
                            `<span class="reaction-pill ${users.includes(currentUser.username) ? 'my-reaction' : ''}" 
                                  onclick="toggleReaction(${m.id}, '${emoji}')" 
                                  title="${users.join(', ')}">${emoji} ${users.length > 1 ? users.length : ''}</span>`
                        ).join('') +
                    `</div>`;
                }

                // Reply preview
                let replyHtml = '';
                if (m.reply_to_id && m.reply_content) {
                    replyHtml = `<div class="reply-preview" onclick="scrollToMessage(${m.reply_to_id})">
                        <span class="reply-sender">${m.reply_sender || 'Unknown'}</span>
                        <span class="reply-text">${truncate(m.reply_content, 60)}</span>
                    </div>`;
                }

                // Deleted message
                const content = m.deleted_for_everyone ? `<em style="opacity:0.6">🚫 This message was deleted</em>` : escapeHtml(m.content);

                // Attachment
                let attachmentHtml = '';
                if (m.attachment_url) {
                    if (m.attachment_type === 'image') {
                        attachmentHtml = `
                            <div class="attachment-bubble">
                                <img src="${m.attachment_url}" class="attachment-image" onclick="window.open('${m.attachment_url}', '_blank')">
                            </div>`;
                    } else if (m.attachment_type === 'pdf') {
                        attachmentHtml = `
                            <div class="attachment-bubble">
                                <a href="${m.attachment_url}" target="_blank" class="pdf-link">
                                    <span class="material-symbols-rounded">picture_as_pdf</span>
                                    <span>Document.pdf</span>
                                </a>
                            </div>`;
                    }
                }

                html += `<div class="message ${isMe ? 'sent' : 'received'}" id="msg-${m.id}" 
                              oncontextmenu="showMessageMenu(event, ${m.id}, ${isMe}, '${escapeAttr(m.content)}', '${m.sender}')">
                    ${!isMe && activeChat.type === 'group' ? `<div class="message-sender">${m.sender}</div>` : ''}
                    ${replyHtml}
                    ${attachmentHtml}
                    ${m.content ? `<div>${content}</div>` : ''}
                    <div class="message-info">
                        <span>${time}</span>
                        ${ticks}
                    </div>
                    ${reactionsHtml}
                </div>`;
            });

            container.innerHTML = html;
        }

        if (!isPoll || wasAtBottom) {
            container.scrollTop = container.scrollHeight;
        }

        if (isPoll && activeChat.type === 'user' && !document.hidden && messages.length > 0) {
            markAsRead(activeChat.id);
        }
    } catch (err) {
        console.error('Error loading messages:', err);
    }
}

function formatDateLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// ============ SEND MESSAGE ============
document.getElementById('chat-input-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content && !document.getElementById('attachment-input').files[0] && !activeChat) return;

    const body = { content };
    if (activeChat.type === 'group') body.groupId = activeChat.id;
    else body.receiverId = activeChat.id;
    if (replyingTo) body.replyToId = replyingTo.id;

    // Handle File Attachment if present
    const fileInput = document.getElementById('attachment-input');
    if (fileInput.files[0]) {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        
        try {
            const uploadRes = await fetch(`${API_URL}/messages/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const uploadData = await uploadRes.json();
            body.attachment_url = uploadData.url;
            body.attachment_type = uploadData.type;
            if (!content) body.content = ''; // Allow empty content with image
        } catch (e) {
            showToast('Error', 'File upload failed');
            return;
        }
    }

    await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
    });
    input.value = '';
    fileInput.value = '';
    document.getElementById('attach-btn').style.color = 'inherit';
    replyingTo = null;
    hideReplyBar();
    loadMessages();
});

// Attachments
document.getElementById('attach-btn').onclick = () => document.getElementById('attachment-input').click();
document.getElementById('attachment-input').onchange = (e) => {
    if (e.target.files[0]) {
        document.getElementById('attach-btn').style.color = 'var(--accent)';
        showToast('System', `File "${e.target.files[0].name}" attached`);
    } else {
        document.getElementById('attach-btn').style.color = 'inherit';
    }
};

// Typing indicator on input
let typingTimeout;
document.getElementById('message-input').addEventListener('input', () => {
    if (!activeChat) return;
    clearTimeout(typingTimeout);
    const chatType = activeChat.type;
    const chatId = activeChat.id;
    
    fetch(`${API_URL}/users/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ chatType, chatId })
    }).catch(() => {});
});

async function checkTypingStatus() {
    if (!activeChat) return;
    try {
        const res = await fetch(`${API_URL}/users/typing?chatType=${activeChat.type}&chatId=${activeChat.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const typingUsers = await res.json();
        const subtitle = document.getElementById('chat-subtitle');
        if (typingUsers.length > 0) {
            subtitle.textContent = `${typingUsers.join(', ')} typing...`;
            subtitle.classList.add('typing-indicator');
        } else {
            subtitle.classList.remove('typing-indicator');
            if (activeChat.type === 'user') {
                updateChatSubtitle(activeChat.id);
            } else {
                subtitle.textContent = 'tap ℹ️ for group info';
            }
        }
    } catch (e) {}
}

// ============ MESSAGE CONTEXT MENU ============
window.showMessageMenu = (event, msgId, isMe, content, sender) => {
    event.preventDefault();
    
    // Remove existing menu
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <div class="context-item" onclick="setReply(${msgId}, '${escapeAttr(sender)}', '${escapeAttr(content)}')">
            <span class="material-symbols-rounded">reply</span> Reply
        </div>
        <div class="context-item" onclick="showReactionPicker(${msgId})">
            <span class="material-symbols-rounded">add_reaction</span> React
        </div>
        ${isMe ? `
            <div class="context-item" onclick="deleteMessage(${msgId}, false)">
                <span class="material-symbols-rounded">delete</span> Delete for me
            </div>
            <div class="context-item danger" onclick="deleteMessage(${msgId}, true)">
                <span class="material-symbols-rounded">delete_forever</span> Delete for everyone
            </div>
        ` : ''}
        <div class="context-item" onclick="copyMessage('${escapeAttr(content)}')">
            <span class="material-symbols-rounded">content_copy</span> Copy
        </div>
    `;

    // Position
    menu.style.left = Math.min(event.clientX, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 200) + 'px';
    document.body.appendChild(menu);

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
};

window.setReply = (msgId, sender, content) => {
    replyingTo = { id: msgId, sender, content };
    showReplyBar();
    document.getElementById('message-input').focus();
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
};

function showReplyBar() {
    let bar = document.getElementById('reply-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'reply-bar';
        const form = document.getElementById('chat-input-form');
        form.parentNode.insertBefore(bar, form);
    }
    bar.innerHTML = `
        <div class="reply-bar-content">
            <div class="reply-bar-line"></div>
            <div class="reply-bar-info">
                <span class="reply-bar-name">${replyingTo.sender}</span>
                <span class="reply-bar-text">${truncate(replyingTo.content, 50)}</span>
            </div>
            <button class="icon-btn-sm" onclick="cancelReply()">
                <span class="material-symbols-rounded">close</span>
            </button>
        </div>
    `;
    bar.style.display = 'block';
}

function hideReplyBar() {
    const bar = document.getElementById('reply-bar');
    if (bar) bar.style.display = 'none';
}

window.cancelReply = () => {
    replyingTo = null;
    hideReplyBar();
};

window.deleteMessage = async (msgId, forEveryone) => {
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
    if (forEveryone && !confirm('Delete this message for everyone?')) return;
    
    await fetch(`${API_URL}/messages/${msgId}?forEveryone=${forEveryone}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    loadMessages();
};

window.copyMessage = (content) => {
    navigator.clipboard.writeText(content).then(() => {
        showToast('Copied', 'Message copied to clipboard');
    });
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
};

window.scrollToMessage = (msgId) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2000);
    }
};

// ============ REACTIONS ============
window.showReactionPicker = (msgId) => {
    document.querySelectorAll('.context-menu').forEach(el => el.remove());
    document.querySelectorAll('.reaction-picker').forEach(el => el.remove());

    const msgEl = document.getElementById(`msg-${msgId}`);
    if (!msgEl) return;

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.innerHTML = REACTION_EMOJIS.map(e => `<span onclick="toggleReaction(${msgId}, '${e}')">${e}</span>`).join('');
    msgEl.appendChild(picker);

    setTimeout(() => {
        document.addEventListener('click', () => picker.remove(), { once: true });
    }, 10);
};

window.toggleReaction = async (msgId, emoji) => {
    document.querySelectorAll('.reaction-picker').forEach(el => el.remove());
    await fetch(`${API_URL}/messages/${msgId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ emoji })
    });
    loadMessages();
};

// ============ EMOJI PICKER ============
const emojiBtn = document.querySelector('.emoji-btn');
if (emojiBtn) {
    emojiBtn.addEventListener('click', () => {
        let picker = document.getElementById('emoji-grid');
        if (picker) {
            picker.remove();
            return;
        }

        picker = document.createElement('div');
        picker.id = 'emoji-grid';
        picker.className = 'emoji-grid';
        picker.innerHTML = EMOJI_LIST.map(e => `<span class="emoji-item" onclick="insertEmoji('${e}')">${e}</span>`).join('');
        
        const form = document.getElementById('chat-input-form');
        form.parentNode.insertBefore(picker, form);
    });
}

window.insertEmoji = (emoji) => {
    const input = document.getElementById('message-input');
    input.value += emoji;
    input.focus();
    document.getElementById('emoji-grid')?.remove();
};

// ============ MESSAGE SEARCH ============
// Add search bar to chat header on demand
window.toggleMessageSearch = () => {
    let searchBar = document.getElementById('msg-search-bar');
    if (searchBar) {
        searchBar.remove();
        return;
    }
    searchBar = document.createElement('div');
    searchBar.id = 'msg-search-bar';
    searchBar.className = 'msg-search-bar';
    searchBar.innerHTML = `
        <input type="text" id="msg-search-input" placeholder="Search messages..." onkeydown="if(event.key==='Enter')searchMessages()">
        <button class="icon-btn-sm" onclick="searchMessages()"><span class="material-symbols-rounded">search</span></button>
        <button class="icon-btn-sm" onclick="this.parentNode.remove()"><span class="material-symbols-rounded">close</span></button>
    `;
    const header = document.getElementById('chat-header');
    header.parentNode.insertBefore(searchBar, header.nextSibling);
};

window.searchMessages = async () => {
    const q = document.getElementById('msg-search-input').value;
    if (!q || !activeChat) return;

    const params = new URLSearchParams({ q });
    if (activeChat.type === 'group') params.set('groupId', activeChat.id);
    else params.set('userId', activeChat.id);

    const res = await fetch(`${API_URL}/messages/search?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const results = await res.json();
    
    if (results.length === 0) {
        showToast('Search', 'No messages found');
    } else {
        showToast('Search', `Found ${results.length} result(s)`);
        // Scroll to first result
        const first = document.getElementById(`msg-${results[0].id}`);
        if (first) {
            first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            first.classList.add('highlight');
            setTimeout(() => first.classList.remove('highlight'), 2000);
        }
    }
};

// ============ GROUP INFO ============
async function showGroupInfo(groupId, groupName) {
    const modal = document.getElementById('group-info-modal-overlay');
    modal.style.display = 'flex';
    document.getElementById('modal-group-name').textContent = groupName;

    const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const members = await res.json();
    document.getElementById('member-count').textContent = members.length;

    const list = document.getElementById('group-member-list');
    list.innerHTML = members.map(m => `
        <li style="cursor:default;">
            <div class="chat-item-container">
                <div class="avatar" style="width:34px; height:34px; font-size:0.8rem; background:${getAvatarColor(m.username)}">${m.username[0].toUpperCase()}</div>
                <div class="chat-info">
                    <div class="chat-name">${m.username} ${m.group_role === 'admin' ? '👑' : ''}</div>
                    <div style="font-size:0.72rem; color:var(--text-muted);">${m.status}</div>
                </div>
            </div>
        </li>
    `).join('');

    const myMembership = members.find(m => m.username === currentUser.username);
    const actionsDiv = document.getElementById('group-actions');

    if (myMembership && myMembership.group_role === 'admin') {
        actionsDiv.style.display = 'block';
        populateFriendDropdown(groupId, members);
    } else {
        actionsDiv.style.display = 'none';
    }

    // Leave Button
    document.getElementById('leave-group-btn').onclick = async () => {
        if (!confirm('Leave this group?')) return;
        await fetch(`${API_URL}/groups/${groupId}/leave`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        modal.style.display = 'none';
        activeChat = null;
        document.getElementById('chat-header').style.display = 'none';
        document.getElementById('chat-input-form').style.display = 'none';
        loadChats();
    };

    // Add Member Button
    const addMemberBtn = document.getElementById('add-member-btn');
    const newBtn = addMemberBtn.cloneNode(true);
    addMemberBtn.parentNode.replaceChild(newBtn, addMemberBtn);

    newBtn.addEventListener('click', async () => {
        const userId = document.getElementById('friend-select-dropdown').value;
        if (!userId) { showToast('Error', 'Select a friend first'); return; }

        try {
            const res = await fetch(`${API_URL}/groups/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ groupId, userId })
            });
            if (res.ok) {
                showToast('Groups', 'Invitation sent! ✉️');
                showGroupInfo(groupId, groupName);
            } else {
                const data = await res.json();
                showToast('Error', data.error || 'Failed to invite');
            }
        } catch (e) {
            showToast('Error', e.message);
        }
    });
}

document.getElementById('close-group-info').onclick = () => {
    document.getElementById('group-info-modal-overlay').style.display = 'none';
};

async function populateFriendDropdown(groupId, currentMembers) {
    const res = await fetch(`${API_URL}/users/friends`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const friends = await res.json();
    const acceptedFriends = friends.filter(f => f.status === 'accepted');
    const memberIds = currentMembers.map(m => m.id);
    const eligible = acceptedFriends.filter(f => !memberIds.includes(f.id));

    const select = document.getElementById('friend-select-dropdown');
    select.innerHTML = '<option value="">Select a friend...</option>' +
        eligible.map(f => `<option value="${f.id}">${f.username}</option>`).join('');
}

// ============ ADMIN ============
// ============ ADMIN ============
document.getElementById('admin-btn').onclick = async () => {
    adminPanel.style.display = 'flex';
    switchAdminTab('users');
    loadAdminStats();
    loadAdminUsers();
};

async function loadAdminStats() {
    const statsRes = await fetch(`${API_URL}/admin/stats`, { headers: { 'Authorization': `Bearer ${token}` } });
    const stats = await statsRes.json();
    document.getElementById('admin-stats').innerHTML = `
        <div class="stat-card"><h3>${stats.users}</h3><p>Total Users</p></div>
        <div class="stat-card"><h3>${stats.groups}</h3><p>Groups</p></div>
        <div class="stat-card"><h3>${stats.messages}</h3><p>Messages</p></div>
        <div class="stat-card"><h3>${stats.online || 0}</h3><p>Online Now</p></div>
    `;
}

async function loadAdminUsers() {
    const usersRes = await fetch(`${API_URL}/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    const users = await usersRes.json();
    document.querySelector('#users-table tbody').innerHTML = users.map(u => `
        <tr>
            <td>${u.id}</td>
            <td>${u.username}</td>
            <td><span class="role-badge ${u.role}">${u.role}</span></td>
            <td>${u.mfa_enabled ? '🔒' : '—'}</td>
            <td>${u.is_online ? '🟢' : '⚫'}</td>
            <td>
                <div style="display:flex; gap:5px;">
                    ${u.role !== 'admin' ? (u.role === 'banned' 
                        ? `<button class="btn-xs" onclick="adminAction('unban', ${u.id})">Unban</button>` 
                        : `<button class="btn-xs" style="background:var(--danger)" onclick="adminAction('ban', ${u.id})">Ban</button>`) 
                    : ''}
                    ${u.role !== 'admin' ? `<button class="btn-xs" style="background:var(--accent)" onclick="adminAction('promote', ${u.id})">Admin</button>` : ''}
                    ${u.mfa_enabled ? `<button class="btn-xs" title="Force Disable MFA" onclick="adminAction('mfa/disable', ${u.id})">🔓 MFA</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadAdminGroups() {
    const res = await fetch(`${API_URL}/admin/groups`, { headers: { 'Authorization': `Bearer ${token}` } });
    const groups = await res.json();
    document.querySelector('#admin-groups-table tbody').innerHTML = groups.map(g => `
        <tr>
            <td>${g.id}</td>
            <td>${g.name}</td>
            <td>${g.creator}</td>
            <td>${g.member_count}</td>
            <td>
                <button class="btn-xs btn-danger" onclick="adminDeleteGroup(${g.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}

async function loadAdminConversations() {
    const res = await fetch(`${API_URL}/admin/conversations`, { headers: { 'Authorization': `Bearer ${token}` } });
    const convs = await res.json();
    const container = document.getElementById('admin-conv-list');
    
    if (convs.length === 0) {
        container.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">No active chats</p>';
    } else {
        container.innerHTML = convs.map(c => `
            <div class="conv-item-admin" onclick="monitorConversation(${c.user1_id}, ${c.user2_id})" style="padding: 8px; background: var(--bg-tertiary); border-radius: 8px; cursor: pointer; border: 1px solid var(--border); transition: all 0.2s;">
                <div style="font-size: 0.85rem; font-weight: 600;">${c.user1_name} & ${c.user2_name}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">ID: ${c.user1_id} & ${c.user2_id}</div>
            </div>
        `).join('');
    }
}

window.monitorConversation = (id1, id2) => {
    document.getElementById('monitor-user-1').value = id1;
    document.getElementById('monitor-user-2').value = id2;
    startMonitoring();
};

window.switchAdminTab = (tabId) => {
    document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('#admin-panel .tabs button').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`admin-content-${tabId}`).style.display = 'block';
    document.getElementById(`admin-tab-${tabId}`).classList.add('active');

    if (tabId === 'users') loadAdminUsers();
    if (tabId === 'groups') loadAdminGroups();
    if (tabId === 'monitor') loadAdminConversations();
};

window.adminAction = async (action, userId) => {
    const res = await fetch(`${API_URL}/admin/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId })
    });
    if (res.ok) {
        showToast('Admin', 'Action completed');
        loadAdminUsers();
        loadAdminStats();
    }
};

window.adminDeleteGroup = async (groupId) => {
    if (!confirm('Are you sure you want to delete this group? This cannot be undone.')) return;
    const res = await fetch(`${API_URL}/admin/group/${groupId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        showToast('Admin', 'Group deleted');
        loadAdminGroups();
        loadAdminStats();
    }
};

let monitorInterval = null;
window.startMonitoring = async () => {
    const u1 = document.getElementById('monitor-user-1').value;
    const u2 = document.getElementById('monitor-user-2').value;
    if (!u1 || !u2) return showToast('Error', 'Enter both User IDs');

    if (monitorInterval) clearInterval(monitorInterval);
    
    const fetchLoop = async () => {
        const res = await fetch(`${API_URL}/messages?userId=${u1}&adminTargetId=${u2}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const messages = await res.json();
        const container = document.getElementById('monitor-messages');
        
        if (messages.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">No messages found between these users</p>';
        } else {
            container.innerHTML = messages.map(m => `
                <div style="margin-bottom:10px; padding:10px; border-radius:8px; background:var(--bg-tertiary);">
                    <div style="font-weight:bold; font-size:0.8rem; color:var(--accent);">${m.sender}</div>
                    <div style="font-size:0.9rem;">${escapeHtml(m.content)}</div>
                    <div style="text-align:right; font-size:0.7rem; color:var(--text-muted);">${new Date(m.timestamp).toLocaleTimeString()}</div>
                </div>
            `).join('');
            container.scrollTop = container.scrollHeight;
        }
    };

    fetchLoop();
    monitorInterval = setInterval(fetchLoop, 5000);
};

// Clear monitor on close
document.getElementById('close-admin').onclick = () => {
    adminPanel.style.display = 'none';
    if (monitorInterval) clearInterval(monitorInterval);
};

// ============ THEME TOGGLE ============
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    currentTheme = theme;
}

window.toggleTheme = async () => {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    // Save to server
    try {
        await fetch(`${API_URL}/users/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ theme: newTheme })
        });
    } catch (e) {}
};

// ============ UNREAD TITLE ============
function updateUnreadTitle() {
    const badges = document.querySelectorAll('.badge');
    let total = 0;
    badges.forEach(b => { total += parseInt(b.textContent) || 0; });
    document.title = total > 0 ? `(${total}) ChatVerse` : 'ChatVerse — Modern Messaging';
}

// ============ UTILITIES ============
function playSound() {
    notificationSound.play().catch(e => {});
}

function showBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '💬' });
    }
}

function showToast(title, body) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<strong>${title}</strong><br>${body}`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getAvatarColor(username) {
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#06b6d4', '#84cc16'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function setAvatar(elementId, username, color = null) {
    const el = document.getElementById(elementId);
    if (!username) { el.style.background = '#555'; el.innerText = '?'; return; }
    el.style.background = color || getAvatarColor(username);
    el.innerText = username[0].toUpperCase();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
}

// ============ PROFILE SETTINGS ============
document.querySelector('.user-profile').addEventListener('click', openProfileSettings);

document.getElementById('close-profile-modal').onclick = () => {
    document.getElementById('profile-modal-overlay').style.display = 'none';
};

async function openProfileSettings() {
    const modal = document.getElementById('profile-modal-overlay');
    modal.style.display = 'flex';
    switchProfileTab('general');

    // Fill data
    document.getElementById('profile-username').textContent = currentUser.username;
    document.getElementById('profile-bio').value = currentUser.bio || '';
    document.getElementById('profile-avatar-color').value = currentUser.avatar_color || '';
    
    setAvatar('profile-avatar-preview', currentUser.username, currentUser.avatar_color);
    updateMFALabel();
}

window.switchProfileTab = (tabId) => {
    document.querySelectorAll('.profile-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tabs button').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`profile-content-${tabId}`).style.display = 'block';
    document.getElementById(`tab-${tabId}`).classList.add('active');
};

window.selectAvatarColor = (color) => {
    document.getElementById('profile-avatar-color').value = color;
    document.getElementById('profile-avatar-preview').style.background = color;
};

window.saveProfileGeneral = async () => {
    const bio = document.getElementById('profile-bio').value;
    const avatar_color = document.getElementById('profile-avatar-color').value;

    try {
        const res = await fetch(`${API_URL}/users/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ bio, avatar_color })
        });
        if (res.ok) {
            const updated = await res.json();
            currentUser = { ...currentUser, ...updated };
            showToast('Profile', 'Profile updated successfully');
            setAvatar('my-avatar', currentUser.username, currentUser.avatar_color);
        }
    } catch (e) {
        showToast('Error', 'Failed to save profile');
    }
};

window.changePassword = async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;

    try {
        const res = await fetch(`${API_URL}/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ oldPassword, newPassword })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Security', 'Password updated successfully');
            e.target.reset();
        } else {
            showToast('Error', data.error);
        }
    } catch (e) {
        showToast('Error', 'Connection error');
    }
};

async function updateMFALabel() {
    const res = await fetch(`${API_URL}/users/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    const user = await res.json();
    currentUser.mfa_enabled = user.mfa_enabled;

    const badge = document.getElementById('mfa-status-badge');
    const enableBtn = document.getElementById('btn-enable-mfa');
    const disableBtn = document.getElementById('btn-disable-mfa');

    if (user.mfa_enabled) {
        badge.textContent = 'Enabled';
        badge.className = 'role-badge admin';
        enableBtn.style.display = 'none';
        disableBtn.style.display = 'block';
    } else {
        badge.textContent = 'Disabled';
        badge.className = 'role-badge user';
        enableBtn.style.display = 'block';
        disableBtn.style.display = 'none';
    }
}

window.enableMFA = () => {
    document.getElementById('profile-modal-overlay').style.display = 'none';
    setupMFA();
};

window.promptDisableMFA = async () => {
    const password = prompt('Please enter your password to disable MFA:');
    if (!password) return;

    try {
        const res = await fetch(`${API_URL}/auth/mfa/disable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ password })
        });
        if (res.ok) {
            showToast('Security', 'MFA disabled');
            updateMFALabel();
        } else {
            const data = await res.json();
            showToast('Error', data.error);
        }
    } catch (e) {
        showToast('Error', 'Connection error');
    }
};

window.toggleSetting = (setting) => {
    const val = document.getElementById(`setting-${setting === 'sound' ? 'sound' : 'browser-notif'}`).checked;
    localStorage.setItem(`setting_${setting}`, val);
    showToast('Settings', `${setting === 'sound' ? 'Sounds' : 'Browser notifications'} ${val ? 'enabled' : 'disabled'}`);
};

// Override toggleTheme to update checkbox
const originalToggleTheme = window.toggleTheme;
window.toggleTheme = async () => {
    await originalToggleTheme();
    const checkbox = document.getElementById('setting-dark-mode');
    if (checkbox) checkbox.checked = (currentTheme === 'dark');
};

// Initial state for settings
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('setting-sound')) {
        document.getElementById('setting-sound').checked = localStorage.getItem('setting_sound') !== 'false';
    }
    if (document.getElementById('setting-browser-notif')) {
        document.getElementById('setting-browser-notif').checked = localStorage.getItem('setting_browserNotif') === 'true';
    }
});

// ============ GAMING HUB ============
const gameModal = document.getElementById('game-modal-overlay');
const gamePlayModal = document.getElementById('game-play-overlay');
let selectedGameType = null;
let currentGameId = null;
let gamePollingInterval = null;

window.openGameHub = () => {
    gameModal.style.display = 'flex';
    backToGameSelection();
};

document.getElementById('close-game-modal').onclick = () => gameModal.style.display = 'none';

window.backToGameSelection = () => {
    document.getElementById('game-selection-view').style.display = 'block';
    document.getElementById('game-invite-view').style.display = 'none';
};

window.selectGame = (type) => {
    selectedGameType = type;
    document.getElementById('game-selection-view').style.display = 'none';
    document.getElementById('game-invite-view').style.display = 'block';
    loadRecentPlayers();
};

async function loadRecentPlayers() {
    const res = await fetch(`${API_URL}/games/recent-players`, { headers: { 'Authorization': `Bearer ${token}` } });
    const players = await res.json();
    const list = document.getElementById('recent-players-list');
    
    if (players.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size: 0.9rem;">No recent players yet.</p>';
    } else {
        list.innerHTML = players.map(p => `
            <div class="search-item" onclick="invitePlayer(${p.id})">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div class="avatar-sm" style="background:${p.avatar_color || getAvatarColor(p.username)}">${p.username[0].toUpperCase()}</div>
                    <span>${p.username}</span>
                </div>
                <button class="btn-xs">Invite</button>
            </div>
        `).join('');
    }
}

window.searchGameUsers = async () => {
    const q = document.getElementById('game-user-search').value;
    if (q.length < 2) return;
    
    const res = await fetch(`${API_URL}/users/search?q=${q}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const users = await res.json();
    const results = document.getElementById('game-search-results');
    
    results.innerHTML = users.map(u => `
        <div class="search-item" onclick="invitePlayer(${u.id})">
            <div style="display:flex; align-items:center; gap:8px;">
                <div class="avatar-sm" style="background:${u.avatar_color || getAvatarColor(u.username)}">${u.username[0].toUpperCase()}</div>
                <span>${u.username}</span>
            </div>
            <button class="btn-xs">Invite</button>
        </div>
    `).join('');
};

window.invitePlayer = async (guestId) => {
    try {
        const res = await fetch(`${API_URL}/games/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ guestId, gameType: selectedGameType })
        });
        if (res.ok) {
            showToast('Gaming', 'Invite sent! Wait for them to accept.');
            gameModal.style.display = 'none';
        }
    } catch (e) { showToast('Error', 'Failed to send invite'); }
};

// Polling for Invites & Active Games
const seenInvites = new Set();
async function checkGameInvites() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/games/invites`, { headers: { 'Authorization': `Bearer ${token}` } });
        const invites = await res.json();
        const container = document.getElementById('sidebar-game-invites');
        const list = document.getElementById('game-invite-list');

        if (invites.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        list.innerHTML = invites.map(inv => `
            <li class="glass" style="margin-bottom:8px; padding:8px; border-radius:8px; display:flex; flex-direction:column; gap:5px;">
                <div style="font-size:0.8rem; font-weight:600;">${inv.host_name} wants to play ${inv.game_type}</div>
                <div style="display:flex; gap:5px;">
                    <button class="btn-xs" style="flex:1" onclick="respondToGameInvite(${inv.id}, 'accepted')">Accept</button>
                    <button class="btn-xs btn-danger" style="flex:1" onclick="respondToGameInvite(${inv.id}, 'rejected')">Decline</button>
                </div>
            </li>
        `).join('');

        // Still sound notification only for NEW ones
        invites.forEach(inv => {
            if (!seenInvites.has(inv.id)) {
                seenInvites.add(inv.id);
                playSound();
            }
        });
    } catch (e) {}
}

// Host detection: join if an invited game is now active
async function checkActiveGames() {
    if (!token || currentGameId) return; // Don't interrupt if already in a game
    try {
        const res = await fetch(`${API_URL}/games/my-active`, { headers: { 'Authorization': `Bearer ${token}` } });
        const active = await res.json();
        if (active.length > 0) {
            startLocalGame(active[0].id);
        }
    } catch (e) {}
}

window.respondToGameInvite = async (inviteId, action) => {
    const res = await fetch(`${API_URL}/games/invite/${inviteId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action })
    });
    if (res.ok && action === 'accepted') {
        const data = await res.json();
        startLocalGame(data.gameId);
    }
    checkGameInvites(); // Refresh list
}

window.startLocalGame = (gameId) => {
    currentGameId = gameId;
    gamePlayModal.style.display = 'flex';
    if (gamePollingInterval) clearInterval(gamePollingInterval);
    pollGameState();
    gamePollingInterval = setInterval(pollGameState, 2000);
};

document.getElementById('close-play-modal').onclick = () => {
    gamePlayModal.style.display = 'none';
    if (gamePollingInterval) clearInterval(gamePollingInterval);
};

async function pollGameState() {
    if (!currentGameId) return;
    try {
        const res = await fetch(`${API_URL}/games/${currentGameId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const game = await res.json();
        renderTTTBoard(game);
        
        if (game.status !== 'active') {
            clearInterval(gamePollingInterval);
            const msg = game.status === 'draw' ? "It's a draw!" : 
                       (game.winner_id === currentUser.id ? "You Won! 🎉" : "You Lost! 💀");
            document.getElementById('game-turn-indicator').textContent = msg;
        }
    } catch (e) { }
}

function renderTTTBoard(game) {
    const state = typeof game.state === 'string' ? JSON.parse(game.state) : game.state;
    const board = state.board;
    const cells = document.querySelectorAll('#ttt-board .cell');
    
    board.forEach((val, i) => {
        cells[i].textContent = val || '';
        cells[i].className = `cell ${val ? val.toLowerCase() : ''}`;
    });

    document.getElementById('game-p1-name').textContent = game.player1_name;
    document.getElementById('game-p2-name').textContent = game.player2_name;
    setAvatar('game-p1-avatar', game.player1_name, game.player1_color);
    setAvatar('game-p2-avatar', game.player2_name, game.player2_color);

    const indicator = document.getElementById('game-turn-indicator');
    if (game.status === 'active') {
        indicator.textContent = game.current_turn_id === currentUser.id ? "Your Turn!" : "Waiting for Opponent...";
    }
}

window.makeMove = async (index) => {
    try {
        const res = await fetch(`${API_URL}/games/${currentGameId}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ index })
        });
        if (res.ok) {
            pollGameState();
        } else {
            const data = await res.json();
            showToast('Game', data.error);
        }
    } catch (e) {}
};
