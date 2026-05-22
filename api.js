const API_BASE = 'https://billsplitter-backend-production-7a67.up.railway.app/api';

async function apiRequest(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
            },
            ...options,
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API Request Failed:', error);
        throw error;
    }
}

// MEMBERS
async function createMember(data) {
    return apiRequest('/members', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

async function getMembers() {
    return apiRequest('/members');
}

// GROUPS
async function createGroup(data) {
    return apiRequest('/groups', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

async function getGroups() {
    return apiRequest('/groups');
}

// EXPENSES
async function createExpense(groupId, data) {
    return apiRequest(`/groups/${groupId}/expenses`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

async function getExpenses(groupId) {
    return apiRequest(`/groups/${groupId}/expenses`);
}

// BALANCES
async function getBalances(groupId) {
    return apiRequest(`/groups/${groupId}/balances`);
}

// SETTLEMENTS
async function getSettlementSuggestions(groupId) {
    return apiRequest(`/groups/${groupId}/settlements/suggestions`);
}

// ANALYTICS
async function getAnalytics(groupId) {
    return apiRequest(`/groups/${groupId}/analytics`);
}

// UPI QR
async function generateUPIQR(data) {
    return apiRequest('/upi/qr', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}