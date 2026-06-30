// Seven Gold CRM — Background Service Worker
// Proxy para chamadas HTTP ao CRM (evita CORS).

importScripts("config.js");

function assertSupabaseConfig() {
  if (!CONFIG?.SUPABASE_URL || !CONFIG?.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Configuração Supabase ausente em config.js. Verifique SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY."
    );
  }
}

const CRM_API_BASE_URL = CONFIG.CRM_API_BASE_URL;
const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_AUTH_KEY = SUPABASE_PUBLISHABLE_KEY;

function assertSupabaseAuthConfig() {
  if (!SUPABASE_URL || !/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(SUPABASE_URL)) {
    throw new Error("Supabase URL inválida no background.js.");
  }

  if (
    !SUPABASE_AUTH_KEY ||
    !(SUPABASE_AUTH_KEY.startsWith("eyJ") || SUPABASE_AUTH_KEY.startsWith("sb_publishable_"))
  ) {
    throw new Error("Supabase public key inválida no background.js.");
  }

  console.log("[Seven Gold CRM][Auth][BG] Supabase URL:", SUPABASE_URL);
  console.log("[Seven Gold CRM][Auth][BG] Public key prefix:", SUPABASE_AUTH_KEY.slice(0, 16));
}

function safeStringify(value) {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

const DEBUG = false;

async function fetchCrmApi(url, options = {}) {
  const { session } = await getStoredAuthSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error('Sessão do CRM ausente ou expirada. Entre novamente com o Google.');
  }

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Seven Gold CRM] Extension installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_LEAD') {
    const url = `${CRM_API_BASE_URL}/api/leads/from-whatsapp-extension`;

    if (DEBUG) console.log('[Seven Gold CRM][BG] Payload recebido:', JSON.stringify(message.data, null, 2));
    if (DEBUG) console.log('[Seven Gold CRM][BG] URL final:', url);

    getStoredAuthSession().then(async ({ session }) => {
      const accessToken = session?.access_token || SUPABASE_PUBLISHABLE_KEY;

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(message.data),
      })
        .then(async (r) => {
          const responseText = await r.text();

          let body;
          try {
            body = JSON.parse(responseText);
          } catch {
            body = {};
          }

          if (r.status === 409 && body.action === 'duplicate') {
            if (body.error) {
              body.error = body.error.replace('CRMou', 'CRM ou');
            }
            console.log('[Seven Gold CRM] Duplicado detectado.');
            return sendResponse({ ok: false, action: 'duplicate', lead: body.lead || null, error: body.error || 'Número duplicado' });
          }

          if (!r.ok) throw new Error(`HTTP ${r.status} - ${responseText}`);

          console.log('[Seven Gold CRM] Lead salvo com sucesso.');
          sendResponse({ ok: true, lead: body.lead || body });
        })
        .catch((err) => {
          console.error('[Seven Gold CRM] Erro de rede:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
    });

    return true; // keep channel open for async response
  }

  if (message.type === 'GET_LEAD_BY_PHONE') {
    const url = `${CRM_API_BASE_URL}/api/leads/by-phone?phone=${encodeURIComponent(message.phone)}`;
    
    fetchCrmApi(url)
      .then(async (r) => {
        if (r.status === 404) {
          return sendResponse({ ok: true, found: false, lead: null });
        }
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const body = await r.json();
        sendResponse(body);
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });

    return true; // keep channel open for async response
  }

  if (message.type === 'GET_LEAD_ASSIGNEES') {
    const url = `${CRM_API_BASE_URL}/api/leads/assignees`;

    fetchCrmApi(url)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        sendResponse(body);
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (message.type === 'ASSIGN_LEAD_RESPONSIBLE') {
    const url = `${CRM_API_BASE_URL}/api/leads/assignees`;

    fetchCrmApi(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: message.lead_id,
        assigned_to_email: message.assigned_to_email,
      }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        sendResponse(body);
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (message.type === 'GET_APPOINTMENTS') {
    const url = `${CRM_API_BASE_URL}/api/appointments/list?start=${encodeURIComponent(message.start)}&end=${encodeURIComponent(message.end)}`;
    
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const body = await r.json();
        sendResponse(body);
      })
      .catch((err) => {
        console.error('[Seven Gold CRM][Calendário] Falha de rede:', err);
        sendResponse({ ok: false, error: err.message });
      });

    return true; // keep channel open for async response
  }

  if (message.type === 'UPDATE_LEAD_STAGE' || message.type === 'UPDATE_LEAD_DETAILS') {
    const isFullUpdate = message.type === 'UPDATE_LEAD_DETAILS' && message.id;
    const idUrl = isFullUpdate ? `${CRM_API_BASE_URL}/api/leads/${encodeURIComponent(message.id)}` : null;
    const stageUrl = `${CRM_API_BASE_URL}/api/leads/update-stage`;
    const stagePayload = message.type === 'UPDATE_LEAD_STAGE'
      ? (() => {
          const p = { phone: message.phone, status: message.status };
          if (message.updated_by_email) p.updated_by_email = message.updated_by_email;
          if (message.updated_by_name) p.updated_by_name = message.updated_by_name;
          if (message.updated_at) p.updated_at = message.updated_at;
          return p;
        })()
      : { id: message.id, phone: message.phone, ...message.data };
    const fullPayload = message.data;

    if (fullPayload) {
      Object.keys(fullPayload).forEach((key) => {
        if (fullPayload[key] === undefined) {
          delete fullPayload[key];
        }
      });
    }

    console.log('[Seven Gold CRM][BG] Tipo:', message.type);
    console.log('[Seven Gold CRM][BG] Endpoint primário:', idUrl || stageUrl);
    console.log('[Seven Gold CRM][BG] Payload:', JSON.stringify(isFullUpdate ? fullPayload : stagePayload, null, 2));

    function parseBody(text) {
      try { return text ? JSON.parse(text) : {}; } catch { return { error: text }; }
    }

    const bodyStr = JSON.stringify(isFullUpdate ? fullPayload : stagePayload);
    console.log('[Seven Gold CRM][BG] Enviando PATCH', isFullUpdate ? idUrl : stageUrl, '| Body length:', bodyStr.length);
    console.log('[Seven Gold CRM][BG] Body:', bodyStr);

    fetchCrmApi(isFullUpdate ? idUrl : stageUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isFullUpdate ? fullPayload : stagePayload)
    })
      .then(async (r) => {
        const body = parseBody(await r.text());
        console.log('[Seven Gold CRM][BG] HTTP', r.status, '| Body:', JSON.stringify(body, null, 2));

        if (r.status === 404 && isFullUpdate) {
          console.log('[Seven Gold CRM][BG] /api/leads/:id retornou 404. Tentando /api/leads/update-stage...');
          return fetchCrmApi(stageUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stagePayload)
          }).then(async (r2) => {
            const body2 = parseBody(await r2.text());
            console.log('[Seven Gold CRM][BG] Fallback HTTP', r2.status, '| Body:', JSON.stringify(body2, null, 2));
            if (!r2.ok) {
              const body2Str = JSON.stringify(body2, null, 2);
              console.error('[Seven Gold CRM][BG] Fallback erro bruto:', body2Str);
              const err2 = body2?.error && typeof body2.error === 'object' ? body2.error : {};
              sendResponse({ ok: false, error: String(err2.message || body2?.message || body2?.error || `HTTP ${r2.status}`), details: String(err2.details || body2?.details || ''), hint: String(err2.hint || body2?.hint || ''), code: String(err2.code || body2?.code || ''), status: r2.status, response: body2 });
              return;
            }
            sendResponse({ ok: true, ...body2 });
          });
        }

        if (!r.ok) {
          console.error('[Seven Gold CRM][BG] Resposta de erro bruta:', JSON.stringify(body, null, 2));
          const err = body?.error && typeof body.error === 'object' ? body.error : {};
          const errorMsg = String(err.message || body?.message || body?.error || body?.detail || `HTTP ${r.status}`);
          const errorDetails = String(err.details || body?.details || '');
          const errorHint = String(err.hint || body?.hint || '');
          const errorCode = String(err.code || body?.code || '');
          console.error('[Seven Gold CRM][BG] Erro extraído:', { errorMsg, errorDetails, errorHint, errorCode });
          sendResponse({ ok: false, error: errorMsg, details: errorDetails, hint: errorHint, code: errorCode, status: r.status, response: body });
          return;
        }

        sendResponse({ ok: true, ...body });
      })
      .catch((err) => {
        console.error('[Seven Gold CRM][BG] Falha de rede no update:', err);
        sendResponse({ ok: false, error: err.message, details: null, hint: null, code: null });
      });

    return true;
  }

  if (message.type === 'INSERT_APPOINTMENT') {
    const url = `${SUPABASE_URL}/rest/v1/appointments`;
    
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(message.payload)
    })
      .then(async (response) => {
        const responseText = await response.text();
        let responseBody = responseText;
        try {
          responseBody = JSON.parse(responseText);
        } catch {}

        if (!response.ok) {
          const detailedError = {
            status: response.status,
            statusText: response.statusText,
            url,
            body: responseBody,
          };

          const errorText = safeStringify(detailedError);
          console.error(`[Seven Gold CRM][Agendamento] HTTP erro detalhado:\n${errorText}`);

          sendResponse({
            ok: false,
            error: errorText,
            status: response.status,
            details: detailedError,
          });
          return;
        }

        const appointmentData = Array.isArray(responseBody) ? responseBody[0] : responseBody;
        sendResponse({ ok: true, appointment: appointmentData });
      })
      .catch((err) => {
        console.error('[Seven Gold CRM][Agendamento] Falha de rede:', err);
        sendResponse({ ok: false, error: err.message });
      });

    return true; // keep channel open for async response
  }

  if (message.type === 'INSERT_LEAD_ACTIVITY_LOG' || message.type === 'GET_LEAD_ACTIVITY_LOGS') {
    getStoredAuthSession().then(async ({ session }) => {
      const accessToken = session?.access_token || SUPABASE_PUBLISHABLE_KEY;

      try {
        let url, fetchOptions;

        if (message.type === 'INSERT_LEAD_ACTIVITY_LOG') {
          url = `${SUPABASE_URL}/rest/v1/lead_activity_logs`;
          fetchOptions = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${accessToken}`,
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(message.payload)
          };
        } else {
          url = `${SUPABASE_URL}/rest/v1/lead_activity_logs?lead_id=eq.${encodeURIComponent(message.lead_id)}&order=created_at.desc`;
          fetchOptions = {
            method: 'GET',
            headers: {
              'apikey': SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${accessToken}`
            }
          };
        }

        const response = await fetch(url, fetchOptions);
        const responseText = await response.text();
        let responseBody = responseText;
        try {
          responseBody = JSON.parse(responseText);
        } catch {}

        if (!response.ok) {
          console.error(`[Seven Gold CRM][Histórico] HTTP ${response.status}:`, responseText);
          sendResponse({ ok: false, error: responseText });
          return;
        }

        if (message.type === 'INSERT_LEAD_ACTIVITY_LOG') {
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: true, logs: responseBody });
        }
      } catch (err) {
        console.error('[Seven Gold CRM][Histórico] Falha de rede:', err);
        sendResponse({ ok: false, error: err.message });
      }
    });

    return true;
  }

  if (message.type === 'OPEN_WHATSAPP_TASK') {
    openWhatsAppTask(message.task);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_TASKS') {
    let url = `${SUPABASE_URL}/rest/v1/tasks?order=scheduled_at.asc`;
    if (message.lead_id) {
      url += `&lead_id=eq.${encodeURIComponent(message.lead_id)}`;
    }
    
    fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    })
      .then(async (response) => {
        const responseText = await response.text();
        let responseBody = responseText;
        try {
          responseBody = JSON.parse(responseText);
        } catch {}

        if (!response.ok) {
          sendResponse({ ok: false, error: responseText });
          return;
        }

        sendResponse({ ok: true, tasks: responseBody });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });

    return true;
  }

  if (message.type === 'INSERT_TASK') {
    const url = `${SUPABASE_URL}/rest/v1/tasks`;
    
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(message.payload)
    })
      .then(async (response) => {
        const responseText = await response.text();
        let responseBody = responseText;
        try {
          responseBody = JSON.parse(responseText);
        } catch {}

        if (!response.ok) {
          sendResponse({ ok: false, error: responseText });
          return;
        }

        const taskData = Array.isArray(responseBody) ? responseBody[0] : responseBody;

        // Agendar alarme diretamente do background service worker
        const when = new Date(taskData.scheduled_at).getTime();
        if (!Number.isNaN(when) && when > Date.now()) {
          const key = `sevenGoldTask:${taskData.id}`;
          await chrome.storage.local.set({ [key]: taskData });
          chrome.alarms.create(key, { when });
          console.log("[Seven Gold CRM][BG] Alarme agendado ao criar tarefa:", taskData.id);
        }

        sendResponse({ ok: true, task: taskData });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });

    return true;
  }

  if (message.type === 'UPDATE_TASK') {
    const url = `${SUPABASE_URL}/rest/v1/tasks?id=eq.${encodeURIComponent(message.id)}`;

    function buildUpdateBody() {
      const body = {
        status: message.status,
        updated_at: new Date().toISOString(),
      };
      if (message.data) {
        if (message.data.completed_by_email) body.completed_by_email = message.data.completed_by_email;
        if (message.data.completed_by_name) body.completed_by_name = message.data.completed_by_name;
        if (message.data.completed_at) body.completed_at = message.data.completed_at;
      }
      return body;
    }

    function doTaskFetch(updateBody) {
      console.log("[Seven Gold CRM][BG] UPDATE_TASK body:", updateBody);
      fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(updateBody)
      })
      .then(async (response) => {
        const responseText = await response.text();
        let responseBody = responseText;
        try {
          responseBody = JSON.parse(responseText);
        } catch {}

        if (!response.ok) {
          sendResponse({ ok: false, error: responseText });
          return;
        }

        const taskData = Array.isArray(responseBody) ? responseBody[0] : responseBody;
        if (!taskData) {
          sendResponse({ ok: false, error: "Nenhuma tarefa foi atualizada. Verifique se possui permissão." });
          return;
        }

        const key = `sevenGoldTask:${message.id}`;
        await chrome.storage.local.remove(key);
        await chrome.alarms.clear(key);
        console.log("[Seven Gold CRM][BG] Alarme limpo ao atualizar tarefa:", message.id);

        sendResponse({ ok: true, task: taskData });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    }

    if (message.data) {
      doTaskFetch(buildUpdateBody());
    } else {
      // Fallback for alarm.js (no data) — try to read from stored user
      chrome.storage.local.get(["sevenGoldCrmUser"]).then((stored) => {
        const crmUser = stored.sevenGoldCrmUser;
        const extraFields = {};
        if (crmUser?.email) {
          extraFields.completed_by_email = crmUser.email;
          extraFields.completed_by_name = crmUser.nome || crmUser.name || crmUser.email;
          if (message.status === 'done') {
            extraFields.completed_at = new Date().toISOString();
          }
        }
        const body = buildUpdateBody();
        doTaskFetch({ ...body, ...extraFields });
      }).catch(() => {
        doTaskFetch(buildUpdateBody());
      });
    }

    return true;
  }

  if (message.type === 'GET_ROLE_PERMISSIONS') {
    const url = `${SUPABASE_URL}/rest/v1/crm_role_permissions?cargo=eq.${encodeURIComponent(message.cargo)}&select=cargo,area_key,area_label,permitido`;

    getStoredAuthSession().then(async ({ session }) => {
      const accessToken = session?.access_token || SUPABASE_PUBLISHABLE_KEY;

      fetch(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${accessToken}`
        }
      })
        .then(async (r) => {
          const responseText = await r.text();
          let responseBody;
          try {
            responseBody = JSON.parse(responseText);
          } catch {
            responseBody = [];
          }

          if (!r.ok) {
            console.error('[Seven Gold CRM] Erro ao buscar permissões:', r.status, responseText);
            sendResponse({ ok: false, error: responseText });
            return;
          }

          console.log('[Seven Gold CRM] Permissões encontradas para cargo "' + message.cargo + '":', responseBody);
          sendResponse({ ok: true, permissions: responseBody });
        })
        .catch((err) => {
          console.error('[Seven Gold CRM] Falha de rede ao buscar permissões:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
    });

    return true;
  }

  if (message.action === 'AUTH_LOGIN_GOOGLE') {
    handleGoogleLoginInBackground()
      .then((result) => {
        sendResponse({ ok: true, session: result.session, crmUser: result.crmUser });
      })
      .catch((error) => {
        console.error('[Seven Gold CRM][Auth][BG] Erro:', error);
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }

  if (message.action === 'AUTH_GET_SESSION') {
    getStoredAuthSession()
      .then((result) => {
        sendResponse({ ok: true, session: result.session, crmUser: result.crmUser });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }

  if (message.action === 'AUTH_LOGOUT') {
    logoutSevenGoldAuth()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }

  if (message.action === 'AUTH_REVALIDATE') {
    revalidateCrmUser()
      .then((crmUser) => {
        sendResponse({ ok: true, crmUser });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log("[Seven Gold CRM][Tarefas] Alarme disparou:", alarm);
  if (!alarm.name.startsWith("sevenGoldTask:")) return;

  const taskId = alarm.name.replace("sevenGoldTask:", "");
  const storageKey = `sevenGoldTask:${taskId}`;

  const stored = await chrome.storage.local.get(storageKey);
  const task = stored[storageKey];

  if (!task) {
    console.warn("[Seven Gold CRM][Tarefas] Tarefa não encontrada no storage:", alarm.name);
    return;
  }

  await handleScheduledTask(task);
});

async function handleScheduledTask(task) {
  console.log("[Seven Gold CRM][Tarefas] Disparando tarefa:", task);

  if (task.type === "whatsapp_message") {
    await triggerWhatsAppMessageTask(task);
  } else if (task.type === "reminder") {
    await triggerReminderTask(task);
  }
}

async function triggerReminderTask(task) {
  chrome.notifications.create(`sevenGoldTaskNotification:${task.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: task.title || "Lembrete Seven Gold CRM",
    message: `${task.lead_nome || "Cliente"} — ${task.internal_note || "Lembrete agendado"}`,
    priority: 2,
  });

  await openAlertPopup(task);
}

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

async function triggerWhatsAppMessageTask(task) {
  const phone = normalizePhoneForWhatsApp(task.lead_telefone);
  const message = task.whatsapp_message || "";

  if (!phone) {
    await triggerReminderTask({
      ...task,
      title: "Mensagem WhatsApp pendente",
      internal_note: "Não foi possível abrir o WhatsApp porque o lead não possui telefone.",
    });
    return;
  }

  chrome.notifications.create(`sevenGoldTaskNotification:${task.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Mensagem WhatsApp agendada",
    message: `${task.lead_nome || "Cliente"} — conversa aberta com mensagem pronta.`,
    priority: 2,
  });

  await openAlertPopup(task);
  await openWhatsAppTask(task);
}

async function openWhatsAppTask(task) {
  const phone = normalizePhoneForWhatsApp(task.lead_telefone);
  const message = encodeURIComponent(task.whatsapp_message || "");
  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${message}`;

  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });

  if (tabs?.length) {
    await chrome.tabs.update(tabs[0].id, { url, active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
}

async function openAlertPopup(task) {
  const url = chrome.runtime.getURL(`alarm.html?taskId=${encodeURIComponent(task.id)}`);

  chrome.windows.create({
    url,
    type: "popup",
    width: 420,
    height: 360,
    focused: true,
  });
}

chrome.runtime.onInstalled.addListener(syncAllAlarms);
chrome.runtime.onStartup.addListener(syncAllAlarms);

async function syncAllAlarms() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/tasks?status=eq.pending`;
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    });
    if (response.ok) {
      const tasks = await response.json();
      for (const task of tasks) {
        const when = new Date(task.scheduled_at).getTime();
        if (when > Date.now()) {
          const key = `sevenGoldTask:${task.id}`;
          await chrome.storage.local.set({ [key]: task });
          chrome.alarms.create(key, { when });
          console.log('[Seven Gold CRM][BG] Alarme ressincronizado:', task.id);
        }
      }
    }
  } catch (e) {
    console.error('[Seven Gold CRM][BG] Erro ao sincronizar alarmes no startup:', e);
  }
}

/* ------------------------------------------------------------------ */
/*  Service Worker — Auth (PKCE-based OAuth flow)                     */
/* ------------------------------------------------------------------ */

function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateRandomString(length = 64) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (v) => charset[v % charset.length]).join("");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(digest);
}

async function exchangeCodeForTokens(code, codeVerifier) {
  if (!codeVerifier) {
    throw new Error("PKCE code_verifier ausente. Inicie o login novamente.");
  }

  const tokenUrl = `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_AUTH_KEY,
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: codeVerifier,
    }),
  });

  const responseText = await response.text();
  let data = responseText;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {}

  if (!response.ok || data?.error) {
    console.error(
      "[Seven Gold CRM][Auth][BG] POST /auth/v1/token falhou:",
      safeStringify({
        status: response.status,
        statusText: response.statusText,
        url: tokenUrl,
        body: data,
      })
    );
    const errMsg = typeof data === "string"
      ? data
      : data.error_description || data.error || data.message || "Erro ao trocar código por sessão.";
    throw new Error(`[POST /auth/v1/token] ${errMsg}`);
  }

  return data;
}

async function attemptFetchUserOrFallback(accessToken) {
  let user = null;
  try {
    user = await fetchSupabaseUser(accessToken);
  } catch (error) {
    console.warn("[Seven Gold CRM][Auth][BG] /auth/v1/user falhou, tentando JWT:", error.message);
  }

  if (!user?.email) {
    const jwtPayload = decodeJwtPayload(accessToken);
    user = {
      ...(user || {}),
      id: user?.id || jwtPayload?.sub,
      email:
        user?.email ||
        jwtPayload?.email ||
        jwtPayload?.user_metadata?.email ||
        jwtPayload?.app_metadata?.email ||
        null,
      user_metadata: jwtPayload?.user_metadata || user?.user_metadata || {},
      app_metadata: jwtPayload?.app_metadata || user?.app_metadata || {},
    };
  }

  if (!user?.email) {
    console.error("[Seven Gold CRM][Auth][BG] Não foi possível identificar e-mail:", safeStringify({
      user,
      tokenPayload: decodeJwtPayload(accessToken),
    }));
    throw new Error("Não foi possível identificar o e-mail do usuário logado.");
  }

  return user;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(normalized)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch (error) {
    console.warn("[Seven Gold CRM][Auth][BG] Falha ao decodificar JWT:", error);
    return null;
  }
}

async function fetchSupabaseUser(accessToken) {
  if (!accessToken) {
    throw new Error("Access token ausente ao buscar usuário.");
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_AUTH_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text();

  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}

  if (!response.ok) {
    const errMsg = typeof body === "string"
      ? body
      : body.error_description || body.error || body.message || "Erro ao buscar usuário logado.";
    console.error("[Seven Gold CRM][Auth][BG] GET /auth/v1/user falhou:", {
      status: response.status,
      body: safeStringify(body),
    });
    throw new Error(`[GET /auth/v1/user] ${errMsg}`);
  }

  return body;
}

function getEmailFromSession(session) {
  return (
    session?.user?.email ||
    session?.user?.user_metadata?.email ||
    null
  );
}

async function handleGoogleLoginInBackground() {
  assertSupabaseConfig();
  assertSupabaseAuthConfig();

  if (!chrome.identity?.getRedirectURL) {
    console.error("[Seven Gold CRM][Auth][BG] chrome.identity nao disponivel.");
    throw new Error("chrome.identity nao esta disponivel. Verifique a permissao identity no manifest.");
  }

  const redirectTo = chrome.identity.getRedirectURL();

  console.log("[Seven Gold CRM][Auth][BG] Redirect URL:", redirectTo);

  const codeVerifier = generateRandomString();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  await chrome.storage.local.set({ sevenGoldPkceVerifier: codeVerifier });

  const params = new URLSearchParams();
  params.set("provider", "google");
  params.set("redirect_to", redirectTo);
  params.set("scopes", "email profile");
  params.set("response_type", "code");
  params.set("code_challenge", codeChallenge);
  params.set("code_challenge_method", "s256");

  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;

  console.log("[Seven Gold CRM][Auth][BG] Auth URL:", authUrl);

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!callbackUrl) {
    throw new Error("Login cancelado ou retorno vazio.");
  }

  console.log("[Seven Gold CRM][Auth][BG] Callback recebido:", callbackUrl);

  const url = new URL(callbackUrl);
  const code = url.searchParams.get("code") || new URLSearchParams(url.hash.replace("#", "")).get("code");

  if (!code) {
    throw new Error("O login não retornou um código de autorização.");
  }

  const stored = await chrome.storage.local.get("sevenGoldPkceVerifier");
  const storedVerifier = stored.sevenGoldPkceVerifier;
  await chrome.storage.local.remove("sevenGoldPkceVerifier");

  const tokenResponse = await exchangeCodeForTokens(code, storedVerifier || codeVerifier);

  const user = await attemptFetchUserOrFallback(tokenResponse.access_token);

  const session = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_in: tokenResponse.expires_in,
    token_type: tokenResponse.token_type || "bearer",
    user,
  };

  console.log("[Seven Gold CRM][Auth][BG] Usuário identificado:", session?.user?.email);

  const crmUser = await checkCrmUserAuthorization(session);

  await chrome.storage.local.set({
    sevenGoldAuthSession: session,
    sevenGoldCrmUser: crmUser,
  });

  console.log("[Seven Gold CRM][Auth][BG] Sessão salva:", {
    email: session?.user?.email,
    userId: session?.user?.id,
  });

  return { session, crmUser };
}

async function checkCrmUserAuthorization(session) {
  const email = getEmailFromSession(session);

  if (!email) {
    console.error("[Seven Gold CRM][Auth][BG] Sessão sem e-mail:", safeStringify(session));
    throw new Error("Não foi possível identificar o e-mail do usuário logado.");
  }

  const normalizedEmail = email.trim().toLowerCase();

  console.log("[Seven Gold CRM][Auth][BG] Validando crm_users:", normalizedEmail);

  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error("Sessão sem access_token para autorização.");
  }

  const url = `${SUPABASE_URL}/rest/v1/crm_users?email=eq.${encodeURIComponent(normalizedEmail)}&ativo=eq.true&select=id,email,nome,cargo,ativo`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_AUTH_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error("[Seven Gold CRM][Auth][BG] Erro ao consultar crm_users:", {
      status: response.status,
      body: errBody,
    });
    throw new Error(`Erro ao validar acesso (${response.status}).`);
  }

  const data = await response.json();

  if (!data || data.length === 0) {
    console.warn("[Seven Gold CRM][Auth][BG] Usuário bloqueado:", normalizedEmail);
    await chrome.storage.local.remove(["sevenGoldAuthSession", "sevenGoldCrmUser"]);
    throw new Error("Usuário não autorizado. Solicite acesso ao administrador.");
  }

  console.log("[Seven Gold CRM][Auth][BG] Usuário autorizado:", data[0]);
  return data[0];
}

async function getStoredAuthSession() {
  const result = await chrome.storage.local.get(["sevenGoldAuthSession", "sevenGoldCrmUser"]);
  return {
    session: result.sevenGoldAuthSession || null,
    crmUser: result.sevenGoldCrmUser || null,
  };
}

async function logoutSevenGoldAuth() {
  await chrome.storage.local.remove(["sevenGoldAuthSession", "sevenGoldCrmUser"]);
  return true;
}

async function revalidateCrmUser() {
  const result = await chrome.storage.local.get(["sevenGoldAuthSession", "sevenGoldCrmUser"]);
  let session = result.sevenGoldAuthSession;

  if (!session) {
    await chrome.storage.local.remove(["sevenGoldAuthSession", "sevenGoldCrmUser"]);
    throw new Error("Sem sessão.");
  }

  let user = session?.user;

  if (!user?.email && session?.access_token) {
    try {
      user = await attemptFetchUserOrFallback(session.access_token);
    } catch (error) {
      console.warn("[Seven Gold CRM][Auth][BG] Revalidacao falhou:", error);
    }

    if (user?.email) {
      session = { ...session, user };
      await chrome.storage.local.set({ sevenGoldAuthSession: session });
    }
  }

  const crmUser = await checkCrmUserAuthorization(session);

  await chrome.storage.local.set({ sevenGoldCrmUser: crmUser });

  return crmUser;
}
