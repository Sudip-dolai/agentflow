// ============================================
// AGENTFLOW — Chatbot Widget
// Embed on any website with one line:
// <script src="https://theagentflow.co/js/chatbot-widget.js" data-agent="AGENT_ID"></script>
// ============================================

(function() {
  const script = document.currentScript || document.querySelector('script[data-agent]');
  const agentId = script?.getAttribute('data-agent');
  if (!agentId) return;

  const API = 'https://getagentflow.co/api';
  let agentData = null;
  let chatStage = 'welcome';
  let leadData = {};
  let isOpen = false;

  // ---- STYLES ----
  const style = document.createElement('style');
  style.textContent = `
    #af-widget * { box-sizing:border-box; font-family:'DM Sans',system-ui,sans-serif; }
    #af-toggle {
      position:fixed; bottom:24px; right:24px; z-index:99999;
      width:58px; height:58px; border-radius:50%;
      background:#c9a84c; border:none; cursor:pointer;
      font-size:1.3rem; box-shadow:0 4px 20px rgba(201,168,76,0.4);
      transition:all 0.2s; display:flex; align-items:center; justify-content:center;
    }
    #af-toggle:hover { transform:scale(1.08); }
    #af-window {
      position:fixed; bottom:96px; right:24px; z-index:99998;
      width:320px; background:#0d1420;
      border:1px solid rgba(255,255,255,0.07); border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,0.6);
      display:none; flex-direction:column; overflow:hidden; max-height:460px;
    }
    #af-window.open { display:flex; }
    #af-header {
      background:#c9a84c; padding:14px 18px;
      display:flex; align-items:center; justify-content:space-between;
    }
    #af-header-left { display:flex; align-items:center; gap:10px; }
    #af-avatar {
      width:34px; height:34px; border-radius:50%;
      background:rgba(0,0,0,0.2); color:#000;
      font-size:0.78rem; font-weight:700;
      display:flex; align-items:center; justify-content:center;
    }
    #af-agent-name { font-weight:700; color:#000; font-size:0.88rem; }
    #af-agent-sub { color:rgba(0,0,0,0.6); font-size:0.72rem; }
    #af-close { background:none; border:none; color:rgba(0,0,0,0.5); cursor:pointer; font-size:1.1rem; }
    #af-messages {
      flex:1; overflow-y:auto; padding:14px;
      display:flex; flex-direction:column; gap:8px;
    }
    .af-msg { max-width:85%; padding:9px 13px; border-radius:10px; font-size:0.84rem; line-height:1.5; }
    .af-msg.bot { background:#111827; color:#e8eaf0; border-radius:10px 10px 10px 3px; align-self:flex-start; }
    .af-msg.user { background:#c9a84c; color:#000; border-radius:10px 10px 3px 10px; align-self:flex-end; font-weight:500; }
    #af-options { display:flex; flex-wrap:wrap; gap:5px; padding:0 14px 10px; }
    .af-opt {
      padding:6px 12px; border-radius:100px;
      border:1px solid rgba(201,168,76,0.3); background:rgba(201,168,76,0.1);
      color:#c9a84c; font-size:0.78rem; cursor:pointer;
      font-family:system-ui,sans-serif; transition:all 0.15s;
    }
    .af-opt:hover { background:#c9a84c; color:#000; }
    #af-input-row { display:flex; gap:7px; padding:10px 14px; border-top:1px solid rgba(255,255,255,0.07); }
    #af-input {
      flex:1; background:#111827; border:1px solid rgba(255,255,255,0.07);
      border-radius:8px; padding:9px 12px; color:#e8eaf0;
      font-size:0.84rem; outline:none;
    }
    #af-input:focus { border-color:rgba(201,168,76,0.4); }
    #af-send {
      background:#c9a84c; color:#000; border:none;
      border-radius:8px; padding:9px 14px; cursor:pointer;
      font-size:0.84rem; font-weight:700; transition:background 0.15s;
    }
    #af-send:hover { background:#e8c97a; }
    #af-powered {
      text-align:center; padding:8px; font-size:0.7rem;
      color:rgba(136,146,164,0.6); border-top:1px solid rgba(255,255,255,0.04);
    }
    #af-powered a { color:rgba(201,168,76,0.6); text-decoration:none; }
    @media(max-width:480px) {
      #af-window { width:calc(100vw - 32px); right:16px; }
    }
  `;
  document.head.appendChild(style);

  // ---- BUILD UI ----
  const container = document.createElement('div');
  container.id = 'af-widget';
  container.innerHTML = `
    <div id="af-window">
      <div id="af-header">
        <div id="af-header-left">
          <div id="af-avatar">AF</div>
          <div>
            <div id="af-agent-name">Alex</div>
            <div id="af-agent-sub">Property Assistant</div>
          </div>
        </div>
        <button id="af-close">✕</button>
      </div>
      <div id="af-messages"></div>
      <div id="af-options"></div>
      <div id="af-input-row">
        <input type="text" id="af-input" placeholder="Type a message…">
        <button id="af-send">Send</button>
      </div>
      <div id="af-powered">Powered by <a href="https://theagentflow.co" target="_blank">AgentFlow</a></div>
    </div>
    <button id="af-toggle">💬</button>
  `;
  document.body.appendChild(container);

  // ---- EVENTS ----
  document.getElementById('af-toggle').onclick = toggleWidget;
  document.getElementById('af-close').onclick = toggleWidget;
  document.getElementById('af-send').onclick = sendMsg;
  document.getElementById('af-input').onkeypress = (e) => { if (e.key === 'Enter') sendMsg(); };

  // ---- LOAD AGENT ----
  fetch(`${API}/chatbot/widget/${agentId}`)
    .then(r => r.json())
    .then(data => {
      agentData = data;
      const initials = (data.bot_name || 'AF').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      document.getElementById('af-avatar').textContent = initials;
      document.getElementById('af-agent-name').textContent = data.bot_name || 'Alex';
      document.getElementById('af-agent-sub').textContent = 'Property Assistant';
    })
    .catch(() => {
      agentData = { bot_name:'Alex', welcome_message:'Hi! Looking for a property? I can help! 🏡' };
    });

  function toggleWidget() {
    isOpen = !isOpen;
    document.getElementById('af-window').classList.toggle('open', isOpen);
    document.getElementById('af-toggle').textContent = isOpen ? '✕' : '💬';
    if (isOpen && document.getElementById('af-messages').children.length === 0) startChat();
  }

  function startChat() {
    chatStage = 'welcome';
    leadData = {};
    const msg = agentData?.welcome_message || 'Hi! Looking for a property? I can help! 🏡';
    addBot(msg);
    showOpts(['Buy', 'Rent', 'Invest', 'Just looking']);
  }

  function addBot(text) {
    const msgs = document.getElementById('af-messages');
    const d = document.createElement('div');
    d.className = 'af-msg bot';
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('af-options').innerHTML = '';
  }

  function addUser(text) {
    const msgs = document.getElementById('af-messages');
    const d = document.createElement('div');
    d.className = 'af-msg user';
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('af-options').innerHTML = '';
  }

  function showOpts(options) {
    document.getElementById('af-options').innerHTML = options.map(o =>
      `<button class="af-opt" onclick="window._af_opt('${o}')">${o}</button>`
    ).join('');
  }

  window._af_opt = (opt) => { addUser(opt); processMsg(opt); };

  function sendMsg() {
    const input = document.getElementById('af-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addUser(text);
    processMsg(text);
  }

  function processMsg(text) {
    const lower = text.toLowerCase();
    setTimeout(() => {
      if (chatStage === 'welcome') {
        leadData.intent = lower.includes('buy') ? 'buy' : lower.includes('rent') ? 'rent' : lower.includes('invest') ? 'invest' : 'browsing';
        chatStage = 'area';
        addBot(`Great! Which areas are you interested in?`);
        showOpts(['Dubai Marina', 'Downtown Dubai', 'Palm Jumeirah', 'Business Bay', 'Other']);
      } else if (chatStage === 'area') {
        leadData.area = text;
        chatStage = 'name';
        addBot(`${text} is a great choice! To send you matching properties, can I get your name?`);
      } else if (chatStage === 'name') {
        leadData.name = text;
        chatStage = 'contact';
        addBot(`Nice to meet you ${text}! What's your email or WhatsApp number?`);
      } else if (chatStage === 'contact') {
        if (text.includes('@')) leadData.email = text;
        else leadData.phone = text;
        chatStage = 'done';
        saveLead();
        addBot(`Thanks ${leadData.name}! 🎉 The agent will be in touch very shortly with matching properties.\n\nWant to book a viewing now?`);
        showOpts(['Yes, book a viewing!', 'No thanks']);
      } else if (chatStage === 'done') {
        if (lower.includes('yes') || lower.includes('book')) {
          window.open(`https://theagentflow.co/pages/book.html?agent=${agentId}`, '_blank');
          addBot('Opening the booking page for you now! 📅');
        } else {
          addBot('No problem! The agent will reach out to you soon. Feel free to chat anytime! 😊');
        }
        chatStage = 'end';
      }
    }, 500);
  }

  function saveLead() {
    fetch(`${API}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        name: leadData.name || 'Unknown',
        email: leadData.email || '',
        phone: leadData.phone || '',
        source: 'website_chatbot',
        notes: `Intent: ${leadData.intent}, Area: ${leadData.area}`
      })
    }).catch(() => {});
  }

})();
