const API_URL = '/api';

// State
let currentUser = null;
let token = localStorage.getItem('token');
let activeChat = null; // { type: 'user' | 'group', id: number, name: string }
let pollingInterval = null;
let lastMsgCount = 0; // For detecting new messages

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

// Init
if (token) {
    validateToken();
} else {
    showAuth();
}

// Auth Logic
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
        document.getElementById('login-mfa').style.display = 'block';
        authMessage.textContent = 'MFA Code required';
    } else {
        authMessage.textContent = data.error;
    }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;

    const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
        token = data.token;
        localStorage.setItem('token', token);
        currentUser = { id: data.userId, username, role: data.role }; // basic info
        
        // Show MFA Setup
        authContainer.style.display = 'none';
        setupMFA();
    } else {
        authMessage.textContent = data.error;
    }
});

// MFA Setup
async function setupMFA() {
    mfaSetupContainer.style.display = 'block';
    const res = await fetch(`${API_URL}/auth/mfa/setup`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    document.getElementById('qrcode-container').innerHTML = `<img src="${data.imageUrl}" alt="MFA QR Code">`;
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
        alert('Invalid Token');
    }
});

document.getElementById('skip-mfa').addEventListener('click', () => {
    mfaSetupContainer.style.display = 'none';
    showDashboard();
});

async function validateToken() {
    const res = await fetch(`${API_URL}/users/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        currentUser = await res.json();
        showDashboard();
    } else {
        logout();
    }
}

function logout() {
    token = null;
    localStorage.removeItem('token');
    currentUser = null;
    clearInterval(pollingInterval);
    showAuth();
}

function showAuth() {
    authContainer.style.display = 'block';
    dashboardContainer.style.display = 'none';
    mfaSetupContainer.style.display = 'none';
    authMessage.textContent = '';
}

// Dashboard Logic
function showDashboard() {
    authContainer.style.display = 'none';
    dashboardContainer.style.display = 'flex';
    document.getElementById('current-username').textContent = currentUser.username;
    setAvatar('my-avatar', currentUser.username);
    
    if (currentUser.role === 'admin') {
        document.getElementById('admin-btn').style.display = 'block';
    }

    // Request Notification Permission
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    loadChats(); // Load both friends and groups
    
    // Start Polling for messages
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
        loadChats(); 
        if (activeChat) loadMessages(true);
    }, 3000);
}

document.getElementById('logout-btn').addEventListener('click', logout);

// Friends & Search
document.getElementById('search-btn').addEventListener('click', async () => {
    const query = document.getElementById('user-search').value;
    if (!query) return;
    const res = await fetch(`${API_URL}/users/search?q=${query}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const users = await res.json();
    const results = document.getElementById('search-results');
    results.style.display = 'block';
    if (users.length === 0) results.innerHTML = '<div style="padding:1rem;">No users found</div>';
    else results.innerHTML = users.map(u => `
        <div class="search-item">
            <div style="display:flex; align-items:center; gap:10px;">
                <div class="avatar" style="width:30px; height:30px; font-size:0.8rem; background:${getAvatarColor(u.username)}">${u.username[0].toUpperCase()}</div>
                <span>${u.username}</span>
            </div>
            <button onclick="sendFriendRequest(${u.id})">Add</button>
        </div>
    `).join('');
});

// Close search on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
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
    showNotification('System', data.message || data.error);
    document.getElementById('search-results').style.display = 'none';
};

/* Unified Chat Loading */
async function loadChats() {
    // 1. Load Friends (DMs)
    const resFriends = await fetch(`${API_URL}/users/friends`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const friends = await resFriends.json();
    
    // 2. Load Groups
    const resGroups = await fetch(`${API_URL}/groups`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const groups = await resGroups.json();

    const chatList = document.getElementById('chat-list');
    const friendList = document.getElementById('friend-list'); // Pending requests here
    const groupList = document.getElementById('group-list');

    // Separate pending and accepted
    const pendingFriends = friends.filter(f => f.status === 'pending');
    const acceptedFriends = friends.filter(f => f.status === 'accepted');

    // Render Pending Requests
    friendList.innerHTML = pendingFriends.map(f => {
         if (f.user2_id === currentUser.id) {
            return `<li>
                <span>${f.username}</span>
                <button class="btn-small" onclick="acceptFriend(${f.friendship_id}, event)">Accept</button>
            </li>`;
         } else {
            return `<li style="opacity:0.7;">${f.username} (Pending)</li>`;
         }
    }).join('');

    // Render Active Chats (Friends)
    chatList.innerHTML = acceptedFriends.map(f => {
         const time = f.last_message_time ? new Date(f.last_message_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
         const isActive = activeChat && activeChat.type === 'user' && activeChat.id === f.id;
         return `<li onclick="openChat('user', ${f.id}, '${f.username}')" class="chat-item-container ${isActive ? 'active' : ''}">
             <div class="avatar" style="background:${getAvatarColor(f.username)}">${f.username[0].toUpperCase()}</div>
             <div class="chat-info">
                 <div class="top-row">
                    <div class="chat-name">${f.username}</div>
                    <span class="chat-time">${time}</span>
                 </div>
                 <div class="bottom-row">
                    <div class="chat-preview">${f.last_message || 'Start a conversation'}</div>
                    ${f.unread_count > 0 ? `<span class="badge">${f.unread_count}</span>` : ''}
                 </div>
             </div>
         </li>`;
    }).join('');

    // Render Groups
    console.log('Rendering groups:', groups);
    groupList.innerHTML = groups.map(g => {
        // Invite Pending
        if (g.status === 'invited') {
            console.log('Found invite for:', g.name);
            return `
            <li class="chat-item-container" style="cursor:default; height: auto; align-items: flex-start; background: #fff7ed; border-left: 4px solid #f59e0b;">
                <div class="avatar" style="background:#f59e0b">✉️</div>
                <div class="chat-info">
                     <div class="chat-name">${g.name} <span style="font-size:0.8em; color:#d97706">(Invited)</span></div>
                     <div style="display:flex; gap:10px; margin-top:5px;">
                        <button class="btn-small" style="padding: 6px 12px; background: var(--primary);" onclick="respondToInvite(${g.id}, 'accept')">Accept</button>
                        <button class="btn-small" style="padding: 6px 12px; background: var(--danger);" onclick="respondToInvite(${g.id}, 'reject')">Reject</button>
                     </div>
                </div>
            </li>`;
        }

        // Pending Join Request
        if (g.status === 'pending') {
             return `<li class="chat-item-container" style="opacity:0.7; cursor:default;">
                <div class="avatar" style="background:#ccc">#</div>
                <div class="chat-info"><div class="chat-name">${g.name} (Request Pending)</div></div>
            </li>`;
        }
        
        // Active Group
        const isActive = activeChat && activeChat.type === 'group' && activeChat.id === g.id;
        return `
        <li onclick="openChat('group', ${g.id}, '${g.name}')" class="chat-item-container ${isActive ? 'active' : ''}">
            <div class="avatar" style="background:${getAvatarColor(g.name)}">#</div>
            <div class="chat-info">
                 <div class="chat-name">${g.name}</div>
            </div>
        </li>`;
    }).join('');
}

window.acceptFriend = async (friendshipId, event) => {
    if (event) event.stopPropagation();
    await fetch(`${API_URL}/users/friends/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ friendshipId })
    });
    loadChats();
};

window.respondToInvite = async (groupId, action) => {
    const endpoint = action === 'accept' ? 'accept' : 'reject';
    await fetch(`${API_URL}/groups/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ groupId })
    });
    loadChats();
};

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
    loadChats();
};

// Chat
window.openChat = async (type, id, name) => {
    activeChat = { type, id, name };
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-title').textContent = name;
    setAvatar('chat-avatar', name);
    document.getElementById('chat-input-form').style.display = 'flex';
    
    // For mobile
    document.getElementById('main-chat-area').classList.add('open');
    document.getElementById('back-btn').style.display = 'block';
    
    // Group Info Button logic
    const groupInfoBtn = document.getElementById('group-info-btn');
    if (type === 'group') {
        groupInfoBtn.style.display = 'block';
        groupInfoBtn.onclick = () => showGroupInfo(id, name);
    } else {
        groupInfoBtn.style.display = 'none';
    }

    // Mark messages as read immediately
    if (type === 'user') {
        await markAsRead(id);
    }
    
    loadMessages();
    loadChats(); // Refresh active state
};

// Mobile Back Button
document.getElementById('back-btn').onclick = () => {
   document.getElementById('main-chat-area').classList.remove('open');
   activeChat = null;
   loadChats(); // Remove active state
};

async function markAsRead(senderId) {
    await fetch(`${API_URL}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ senderId })
    });
}

async function loadMessages(isPoll = false) {
    if (!activeChat) return;
    const query = activeChat.type === 'group' ? `groupId=${activeChat.id}` : `userId=${activeChat.id}`;
    const res = await fetch(`${API_URL}/messages?${query}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const messages = await res.json();
    
    const container = document.getElementById('chat-messages');

    // Notify logic
    if (isPoll && messages.length > lastMsgCount && document.hidden) {
        playSound();
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.sender !== currentUser.username) {
            showNotification(`New message from ${lastMsg.sender}`, lastMsg.content);
        }
    }
    if (!isPoll) lastMsgCount = messages.length; 
    else if (messages.length > lastMsgCount) {
        lastMsgCount = messages.length; 
        playSound();
    }

    // Only scroll if we were at bottom or it's a manual load
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    
    if (messages.length === 0) {
        container.innerHTML = `<div class="placeholder"><p>No messages yet.</p></div>`;
    } else {
        container.innerHTML = messages.map(m => {
            const isMe = m.sender === currentUser.username;
            const ticks = isMe ? `<span class="ticks ${m.is_read ? 'read' : ''}">${m.is_read ? '✓✓' : '✓'}</span>` : '';
            const time = new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            return `<div class="message ${isMe ? 'sent' : 'received'}">
                ${!isMe && activeChat.type === 'group' ? `<div class="message-sender">${m.sender}</div>` : ''}
                <div>${m.content}</div>
                <div class="message-info">
                    <span>${time}</span>
                    ${ticks}
                </div>
            </div>`;
        }).join('');
    }

    if (!isPoll || wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
    
    if (isPoll && activeChat.type === 'user' && !document.hidden && messages.length > 0) {
        markAsRead(activeChat.id);
    }
}

document.getElementById('chat-input-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const content = input.value;
    if (!content || !activeChat) return;

    const body = { content };
    if (activeChat.type === 'group') body.groupId = activeChat.id;
    else body.receiverId = activeChat.id;

    await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
    });
    input.value = '';
    loadMessages();
});

// Group Info Logic
async function showGroupInfo(groupId, groupName) {
    const modal = document.getElementById('group-info-modal-overlay');
    modal.style.display = 'flex';
    document.getElementById('modal-group-name').textContent = groupName;
    
    // Load Members
    const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
         headers: { 'Authorization': `Bearer ${token}` }
    });
    const members = await res.json();
    document.getElementById('member-count').textContent = members.length;
    
    const list = document.getElementById('group-member-list');
    list.innerHTML = members.map(m => `
        <li style="cursor:default; background:transparent;">
            <div style="display:flex; align-items:center; gap:10px;">
                <div class="avatar" style="width:32px; height:32px; font-size:0.8rem; background:${getAvatarColor(m.username)}">${m.username[0].toUpperCase()}</div>
                <div>
                     <div style="font-weight:600; font-size:0.9rem;">${m.username}</div>
                     <div style="font-size:0.75rem; color:#666;">${m.role} • ${m.status}</div>
                </div>
            </div>
            ${m.role === 'admin' ? '👑' : ''}
        </li>
    `).join('');

    // Check if I am admin
    const myMembership = members.find(m => m.username === currentUser.username);
    const actionsDiv = document.getElementById('group-actions');
    
    if (myMembership && myMembership.role === 'admin') {
        actionsDiv.style.display = 'block';
        populateFriendDropdown(groupId, members); // Only show friends NOT in group
    } else {
        actionsDiv.style.display = 'none';
    }

    // Leave Button
    document.getElementById('leave-group-btn').onclick = async () => {
        if (!confirm('Are you sure you want to leave this group?')) return;
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
    // Add Member Button
    const addMemberBtn = document.getElementById('add-member-btn');
    // Remove old listeners to avoid duplicates if re-opened
    const newBtn = addMemberBtn.cloneNode(true);
    addMemberBtn.parentNode.replaceChild(newBtn, addMemberBtn);
    
    newBtn.addEventListener('click', async () => {
        console.log('Add Member button clicked');
        const select = document.getElementById('friend-select-dropdown');
        const userId = select.value;
        console.log('Selected User ID:', userId);
        
        if (!userId) {
            alert('Please select a friend to add.');
            return;
        }
        
        try {
            console.log(`Attempting to invite User ${userId} to Group ${groupId}`);
            const res = await fetch(`${API_URL}/groups/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ groupId, userId })
            });
            
            console.log('Invite response status:', res.status);
            
            if (!res.ok) {
                const text = await res.text();
                console.error('Invite failed response:', text);
                try {
                     const json = JSON.parse(text);
                     alert(json.error || `Server Error: ${res.status}`);
                } catch (e) {
                     alert(`Server Error: ${res.status} - ${text}`);
                }
                return;
            }

            const d = await res.json();
            alert('Invitation sent successfully!');
            showGroupInfo(groupId, groupName); // Refresh

        } catch (e) {
            console.error('Invite exception:', e);
            alert(`Client Error: ${e.message}`);
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
    
    // Filter out existing members
    const memberIds = currentMembers.map(m => m.id);
    const eligibleFriends = acceptedFriends.filter(f => !memberIds.includes(f.id));
    
    const select = document.getElementById('friend-select-dropdown');
    select.innerHTML = '<option value="">Select a friend to add...</option>' + 
        eligibleFriends.map(f => `<option value="${f.id}">${f.username}</option>`).join('');
}

// Admin
document.getElementById('admin-btn').onclick = async () => {
    adminPanel.style.display = 'block';
    
    // Load Stats
    const statsRes = await fetch(`${API_URL}/admin/stats`, { headers: { 'Authorization': `Bearer ${token}` } });
    const stats = await statsRes.json();
    document.getElementById('admin-stats').innerHTML = `
        <div class="stat-card"><h3>${stats.users}</h3><p>Users</p></div>
        <div class="stat-card"><h3>${stats.groups}</h3><p>Groups</p></div>
        <div class="stat-card"><h3>${stats.messages}</h3><p>Messages</p></div>
    `;

    // Load Users
    const usersRes = await fetch(`${API_URL}/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    const users = await usersRes.json();
    document.querySelector('#users-table tbody').innerHTML = users.map(u => `
        <tr>
            <td>${u.id}</td>
            <td>${u.username}</td>
            <td>${u.role}</td>
            <td>${u.mfa_enabled ? 'Enabled' : 'Disabled'}</td>
        </tr>
    `).join('');
};

document.getElementById('close-admin').onclick = () => {
    adminPanel.style.display = 'none';
};

// Utilities
function playSound() {
    notificationSound.play().catch(e => console.log('Audio play error', e));
}

function showNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<strong>${title}</strong><br>${body}`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function getAvatarColor(username) {
    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function setAvatar(elementId, username) {
    const el = document.getElementById(elementId);
    if (!username) { el.style.background = '#ccc'; el.innerText = '?'; return; }
    el.style.background = getAvatarColor(username);
    el.innerText = username[0].toUpperCase();
}
