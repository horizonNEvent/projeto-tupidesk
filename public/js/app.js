// GLOBAL APP STATE
let allTickets = [];
let selectedTicket = null;
let categoryChartInstance = null;
let sentimentChartInstance = null;

// On Page Load
document.addEventListener('DOMContentLoaded', () => {
  fetchTickets();
  // Atualiza a cada 30 segundos
  setInterval(fetchTickets, 30000);
});

// View Switching
function switchView(viewName) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));

  if (viewName === 'client') {
    document.getElementById('view-client').classList.add('active');
    document.getElementById('tab-client-btn').classList.add('active');
  } else {
    document.getElementById('view-agent').classList.add('active');
    document.getElementById('tab-agent-btn').classList.add('active');
    // Forçar renderização de gráficos ao entrar na view de agente
    setTimeout(renderCharts, 100);
  }
}

// Fetch Tickets from API
async function fetchTickets() {
  try {
    const res = await fetch('/api/tickets');
    if (!res.ok) throw new Error('Falha ao buscar chamados');
    allTickets = await res.ok ? await res.json() : [];
    
    // Atualizar UI
    renderClientTickets();
    renderKanban();
    updateMetrics();
    renderCharts();
    
    // Se o drawer estiver aberto, atualiza os dados do chamado selecionado
    if (selectedTicket) {
      const updated = allTickets.find(t => t.id === selectedTicket.id);
      if (updated) {
        selectedTicket = updated;
        populateDrawerDetails();
      }
    }
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados do servidor', 'error');
  }
}

// TOAST NOTIFICATIONS
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '<i class="fa-solid fa-circle-info"></i>';
  if (type === 'success') icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  // Remove após 4 segundos
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s forwards ease-in';
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

// --- CLIENT LOGIC ---

// Create Ticket Submission
async function handleCreateTicket(event) {
  event.preventDefault();
  
  const nameInput = document.getElementById('client-name');
  const emailInput = document.getElementById('client-email');
  const descInput = document.getElementById('ticket-desc');
  const submitBtn = document.getElementById('submit-ticket-btn');

  // Loading State
  const originalBtnHTML = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>IA realizando triagem...</span> <i class="fa-solid fa-circle-notch fa-spin"></i>`;

  const payload = {
    clientName: nameInput.value.trim(),
    clientEmail: emailInput.value.trim(),
    description: descInput.value.trim()
  };

  try {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha ao enviar chamado');
    
    const newTicket = await res.json();
    showToast(`Chamado criado com sucesso! Prioridade IA: ${newTicket.aiAnalysis.urgency}`, 'success');
    
    // Clear inputs
    descInput.value = '';
    
    // Refresh Data
    await fetchTickets();
    
  } catch (err) {
    console.error(err);
    showToast('Erro ao abrir o chamado. Tente novamente.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnHTML;
  }
}

// Render Tickets for Client Portal
function renderClientTickets() {
  const container = document.getElementById('client-tickets-list');
  if (allTickets.length === 0) {
    container.innerHTML = `<div class="loading-spinner">Nenhum chamado aberto ainda.</div>`;
    return;
  }

  // Ordena por data (mais novos primeiro)
  const sorted = [...allTickets].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = sorted.map(t => {
    const dateStr = new Date(t.createdAt).toLocaleString('pt-BR');
    let statusClass = 'badge-new';
    let statusText = 'Novo';
    
    if (t.status === 'em_progresso') {
      statusClass = 'badge-progress';
      statusText = 'Em Progresso';
    } else if (t.status === 'resolvido') {
      statusClass = 'badge-resolved';
      statusText = 'Resolvido';
    }

    return `
      <div class="client-ticket-item" onclick="openTicketDetailsDirect('${t.id}')" style="cursor: pointer;">
        <div class="ticket-item-left">
          <div class="ticket-item-meta">
            <span class="ticket-item-id">${t.id}</span>
            <span>${dateStr}</span>
            <span class="category-tag">${t.aiAnalysis.category}</span>
          </div>
          <div class="ticket-item-title">${t.aiAnalysis.summary}</div>
        </div>
        <div class="ticket-item-right">
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      </div>
    `;
  }).join('');
}

function openTicketDetailsDirect(id) {
  // Abre o drawer mesmo estando na aba cliente (facilita pro usuário testar)
  const ticket = allTickets.find(t => t.id === id);
  if (ticket) {
    openDrawer(ticket);
  }
}

// --- AGENT LOGIC (KANBAN & METRICS) ---

// Update Metric Cards
function updateMetrics() {
  document.getElementById('metric-total').innerText = allTickets.length;
  
  const criticalCount = allTickets.filter(t => 
    t.aiAnalysis.urgency.toLowerCase() === 'crítico' || 
    t.aiAnalysis.urgency.toLowerCase() === 'crítico' ||
    t.aiAnalysis.urgency.toLowerCase() === 'alto'
  ).length;
  document.getElementById('metric-critical').innerText = criticalCount;

  const pendingCount = allTickets.filter(t => t.status === 'em_progresso').length;
  document.getElementById('metric-pending').innerText = pendingCount;

  const resolvedCount = allTickets.filter(t => t.status === 'resolvido').length;
  document.getElementById('metric-resolved').innerText = resolvedCount;
}

// Filter tickets from inputs
function filterTickets() {
  renderKanban();
}

// Render Kanban columns
function renderKanban() {
  const searchQuery = document.getElementById('search-input').value.toLowerCase();
  const categoryFilter = document.getElementById('category-filter').value;

  const filtered = allTickets.filter(t => {
    const matchesSearch = t.id.toLowerCase().includes(searchQuery) || 
                          t.clientName.toLowerCase().includes(searchQuery) || 
                          t.aiAnalysis.summary.toLowerCase().includes(searchQuery) ||
                          t.description.toLowerCase().includes(searchQuery);

    const matchesCategory = categoryFilter === 'all' || t.aiAnalysis.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  const columns = {
    novo: document.getElementById('cards-novo'),
    em_progresso: document.getElementById('cards-em_progresso'),
    resolvido: document.getElementById('cards-resolvido')
  };

  // Limpa colunas
  Object.keys(columns).forEach(k => {
    columns[k].innerHTML = '';
  });

  let counts = { novo: 0, em_progresso: 0, resolvido: 0 };

  filtered.forEach(t => {
    const colName = t.status || 'novo';
    if (!columns[colName]) return;
    
    counts[colName]++;

    const card = document.createElement('div');
    card.className = `ticket-card-kanban urgency-${t.aiAnalysis.urgency.toLowerCase().replace('í', 'i')}`;
    card.draggable = true;
    card.id = `card-${t.id}`;
    card.onclick = () => openDrawer(t);
    card.ondragstart = (e) => handleDragStart(e, t.id);

    let sentimentIcon = '<i class="fa-solid fa-face-meh"></i>';
    let sentimentClass = 'sentiment-neutro';
    if (t.aiAnalysis.sentiment.toLowerCase() === 'frustrado') {
      sentimentIcon = '<i class="fa-solid fa-face-frown"></i>';
      sentimentClass = 'sentiment-frustrado';
    } else if (t.aiAnalysis.sentiment.toLowerCase() === 'satisfeito') {
      sentimentIcon = '<i class="fa-solid fa-face-smile"></i>';
      sentimentClass = 'sentiment-satisfeito';
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="card-id">${t.id}</span>
        <span class="category-tag">${t.aiAnalysis.category}</span>
      </div>
      <div class="card-title">${t.aiAnalysis.summary}</div>
      <div class="card-footer">
        <span class="card-client"><i class="fa-solid fa-user-circle"></i> ${t.clientName.split(' ')[0]}</span>
        <span class="card-sentiment ${sentimentClass}">
          ${sentimentIcon} ${t.aiAnalysis.sentiment}
        </span>
      </div>
    `;

    columns[colName].appendChild(card);
  });

  // Atualiza contadores
  document.getElementById('count-novo').innerText = counts.novo;
  document.getElementById('count-em_progresso').innerText = counts.em_progresso;
  document.getElementById('count-resolvido').innerText = counts.resolvido;
}

// Drag & Drop Handlers
function handleDragStart(e, ticketId) {
  e.dataTransfer.setData('text/plain', ticketId);
  e.dataTransfer.effectAllowed = 'move';
}

function allowDrop(e) {
  e.preventDefault();
}

async function handleDrop(e, targetStatus) {
  e.preventDefault();
  const ticketId = e.dataTransfer.getData('text/plain');
  if (!ticketId) return;

  const ticket = allTickets.find(t => t.id === ticketId);
  if (!ticket || ticket.status === targetStatus) return;

  try {
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus })
    });

    if (!res.ok) throw new Error('Falha ao atualizar chamado');

    showToast(`Chamado ${ticketId} movido para ${targetStatus.replace('_', ' ')}`, 'success');
    await fetchTickets();
  } catch (err) {
    console.error(err);
    showToast('Erro ao mover chamado', 'error');
  }
}

// --- DRAWER DETAILS & COPILOT CHAT ---

function openDrawer(ticket) {
  selectedTicket = ticket;
  document.getElementById('detail-drawer').classList.add('active');
  switchDrawerTab('details');
  populateDrawerDetails();
  
  // Limpa mensagens anteriores do chat da IA
  const chatBox = document.getElementById('ai-chat-messages-box');
  chatBox.innerHTML = `
    <div class="chat-msg system">
      Olá! Sou o Copiloto IA do TupiDesk. Como posso ajudar você a resolver o chamado do cliente <strong>${ticket.clientName}</strong>? Você pode me fazer perguntas técnicas ou pedir para redigir respostas.
    </div>
  `;
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('active');
  selectedTicket = null;
}

function switchDrawerTab(tab) {
  document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.drawer-section').forEach(s => s.classList.remove('active'));

  if (tab === 'details') {
    document.getElementById('tab-det-btn').classList.add('active');
    document.getElementById('drawer-sec-details').classList.add('active');
  } else {
    document.getElementById('tab-chat-btn').classList.add('active');
    document.getElementById('drawer-sec-chat').classList.add('active');
  }
}

async function populateDrawerDetails() {
  if (!selectedTicket) return;

  const t = selectedTicket;
  
  // IDs & Headers
  document.getElementById('drawer-ticket-id').innerText = t.id;
  document.getElementById('drawer-ticket-title').innerText = t.aiAnalysis.summary;

  // Client Info
  document.getElementById('drawer-client-name').innerText = t.clientName;
  document.getElementById('drawer-client-email').innerText = t.clientEmail;
  document.getElementById('drawer-created-at').innerText = new Date(t.createdAt).toLocaleString('pt-BR');
  
  // Status Badge
  const statusBadge = document.getElementById('drawer-status-badge');
  statusBadge.className = 'status-badge';
  if (t.status === 'novo') {
    statusBadge.classList.add('badge-new');
    statusBadge.innerText = 'Novo';
  } else if (t.status === 'em_progresso') {
    statusBadge.classList.add('badge-progress');
    statusBadge.innerText = 'Em Progresso';
  } else {
    statusBadge.classList.add('badge-resolved');
    statusBadge.innerText = 'Resolvido';
  }

  // Description
  document.getElementById('drawer-description').innerText = t.description;

  // AI Classification
  document.getElementById('drawer-ai-urgency').innerText = t.aiAnalysis.urgency;
  document.getElementById('drawer-ai-sentiment').innerText = t.aiAnalysis.sentiment;
  document.getElementById('drawer-ai-category').innerText = t.aiAnalysis.category;

  // Color values
  const urgencyEl = document.getElementById('drawer-ai-urgency');
  urgencyEl.className = 'ai-value';
  const u = t.aiAnalysis.urgency.toLowerCase();
  if (u === 'crítico' || u === 'alto') urgencyEl.style.color = 'var(--color-critical)';
  else if (u === 'médio') urgencyEl.style.color = 'var(--color-progress)';
  else urgencyEl.style.color = 'var(--color-low)';

  // Similarity
  document.getElementById('drawer-score-jaccard').innerText = t.aiAnalysis.jaccardScore || '0.00';
  document.getElementById('drawer-score-levenshtein').innerText = t.aiAnalysis.levenshteinScore || '0.00';
  
  // Matched KB
  const kbTitleEl = document.getElementById('drawer-kb-title');
  if (t.aiAnalysis.matchedArticleId) {
    // Busca do servidor ou local
    try {
      const res = await fetch('/api/kb');
      const kb = await res.json();
      const article = kb.find(a => a.id === t.aiAnalysis.matchedArticleId);
      kbTitleEl.innerText = article ? `${article.id} - ${article.title}` : t.aiAnalysis.matchedArticleId;
    } catch {
      kbTitleEl.innerText = t.aiAnalysis.matchedArticleId;
    }
  } else {
    kbTitleEl.innerText = 'Nenhum artigo encontrado';
  }

  // AI Response Suggestion
  document.getElementById('drawer-suggested-response').value = t.suggestedResponse || '';

  // Comments timeline
  const timeline = document.getElementById('drawer-comments-timeline');
  timeline.innerHTML = t.comments.map(c => {
    const senderName = c.sender === 'client' ? 'Cliente' : 'Atendente';
    const dateStr = new Date(c.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="comment-bubble ${c.sender}">
        <div>${c.text}</div>
        <div class="comment-meta">
          <strong>${senderName}</strong>
          <span>${dateStr}</span>
        </div>
      </div>
    `;
  }).join('');
  
  // Auto scroll to bottom
  timeline.scrollTop = timeline.scrollHeight;
}

// Copy AI suggestion to clipboard or prompt area
function copySuggestedResponse() {
  const text = document.getElementById('drawer-suggested-response').value;
  navigator.clipboard.writeText(text);
  showToast('Sugestão copiada!', 'success');
}

// Send Agent Response (and mark ticket resolved)
async function sendAgentResponse() {
  if (!selectedTicket) return;
  
  const text = document.getElementById('drawer-suggested-response').value.trim();
  if (!text) {
    showToast('A resposta não pode ser vazia.', 'error');
    return;
  }

  try {
    // 1. Envia comentário
    const comRes = await fetch(`/api/tickets/${selectedTicket.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'agent', text })
    });

    if (!comRes.ok) throw new Error('Erro ao registrar resposta');

    // 2. Resolve chamado
    const statusRes = await fetch(`/api/tickets/${selectedTicket.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolvido' })
    });

    if (!statusRes.ok) throw new Error('Erro ao atualizar status');

    showToast('Chamado respondido e resolvido!', 'success');
    closeDrawer();
    await fetchTickets();
  } catch (err) {
    console.error(err);
    showToast('Erro ao processar resposta', 'error');
  }
}

// Add General Comment / Ticket Note
async function addComment() {
  if (!selectedTicket) return;

  const input = document.getElementById('new-comment-input');
  const text = input.value.trim();
  if (!text) return;

  try {
    const res = await fetch(`/api/tickets/${selectedTicket.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'agent', text })
    });

    if (!res.ok) throw new Error('Erro ao adicionar nota');

    input.value = '';
    showToast('Nota adicionada ao chamado', 'success');
    await fetchTickets();
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar nota', 'error');
  }
}

// Send AI Copilot Chat Message
async function sendAIChatMessage() {
  if (!selectedTicket) return;

  const input = document.getElementById('ai-chat-input');
  const message = input.value.trim();
  if (!message) return;

  const chatBox = document.getElementById('ai-chat-messages-box');
  
  // Render user message
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-msg user';
  userMsgEl.innerText = message;
  chatBox.appendChild(userMsgEl);
  
  input.value = '';
  chatBox.scrollTop = chatBox.scrollHeight;

  // Typing Indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-msg assistant typing';
  typingEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Groq está analisando...`;
  chatBox.appendChild(typingEl);
  chatBox.scrollTop = chatBox.scrollHeight;

  try {
    const res = await fetch(`/api/tickets/${selectedTicket.id}/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!res.ok) throw new Error();
    const data = await res.json();
    
    // Remove typing
    typingEl.remove();

    // Render assistant reply
    const replyEl = document.createElement('div');
    replyEl.className = 'chat-msg assistant';
    replyEl.innerHTML = formatMarkdown(data.reply);
    chatBox.appendChild(replyEl);

  } catch {
    typingEl.remove();
    const errEl = document.createElement('div');
    errEl.className = 'chat-msg assistant';
    errEl.style.borderColor = 'var(--color-critical)';
    errEl.innerText = 'Erro ao se comunicar com a IA da Groq. Verifique a chave no .env.';
    chatBox.appendChild(errEl);
  }
  
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Simple Markdown parser for chatbot formatting
function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// --- CHARTS GENERATION (CHART.JS) ---

function renderCharts() {
  const activeTab = document.getElementById('tab-agent-btn').classList.contains('active');
  if (!activeTab || allTickets.length === 0) return;

  // 1. CATEGORY CHART
  const categories = {};
  allTickets.forEach(t => {
    const cat = t.aiAnalysis.category;
    categories[cat] = (categories[cat] || 0) + 1;
  });

  const catLabels = Object.keys(categories);
  const catData = Object.values(categories);

  const ctxCategory = document.getElementById('categoryChart');
  if (ctxCategory) {
    if (categoryChartInstance) categoryChartInstance.destroy();
    
    categoryChartInstance = new Chart(ctxCategory, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: [
            'rgba(59, 130, 246, 0.75)',  // Blue
            'rgba(16, 185, 129, 0.75)',  // Green
            'rgba(245, 158, 11, 0.75)',   // Orange
            'rgba(244, 63, 94, 0.75)',    // Red
            'rgba(139, 92, 246, 0.75)'    // Purple
          ],
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#9ca3af',
              font: { family: 'Inter', size: 10 }
            }
          }
        }
      }
    });
  }

  // 2. SENTIMENT CHART
  const sentiments = { 'Frustrado': 0, 'Neutro': 0, 'Satisfeito': 0 };
  allTickets.forEach(t => {
    const s = t.aiAnalysis.sentiment;
    if (sentiments[s] !== undefined) sentiments[s]++;
  });

  const ctxSentiment = document.getElementById('sentimentChart');
  if (ctxSentiment) {
    if (sentimentChartInstance) sentimentChartInstance.destroy();

    sentimentChartInstance = new Chart(ctxSentiment, {
      type: 'bar',
      data: {
        labels: Object.keys(sentiments),
        datasets: [{
          label: 'Quantidade',
          data: Object.values(sentiments),
          backgroundColor: [
            'rgba(244, 63, 94, 0.65)',  // Frustrado (Red)
            'rgba(156, 163, 175, 0.65)', // Neutro (Gray)
            'rgba(16, 185, 129, 0.65)'  // Satisfeito (Green)
          ],
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#9ca3af', font: { family: 'Inter' } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#9ca3af', stepSize: 1, font: { family: 'Inter' } }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}
