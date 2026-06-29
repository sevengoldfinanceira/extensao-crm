function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.3); // 300ms beep
  } catch (e) {
    console.error('[Seven Gold CRM] Audio Context failed:', e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  playBeep();

  const urlParams = new URLSearchParams(window.location.search);
  const taskId = urlParams.get('taskId');

  if (!taskId) {
    console.warn('[Seven Gold CRM][Alarm] No taskId parameter found');
    return;
  }

  const storageKey = `sevenGoldTask:${taskId}`;
  const stored = await chrome.storage.local.get(storageKey);
  const task = stored[storageKey];

  if (!task) {
    console.error('[Seven Gold CRM][Alarm] Task not found in local storage:', taskId);
    document.getElementById('task-title').textContent = 'Tarefa não encontrada';
    return;
  }

  // Populate data
  document.getElementById('client-name').textContent = task.lead_nome || 'Cliente não especificado';
  document.getElementById('internal-note').textContent = task.internal_note || 'Nenhuma anotação';

  if (task.type === 'whatsapp_message') {
    document.getElementById('task-title').textContent = 'Mensagem WhatsApp agendada';
    document.getElementById('wa-msg-field').style.display = 'block';
    document.getElementById('wa-message').textContent = task.whatsapp_message || '';
    
    if (task.lead_telefone) {
      const btnWa = document.getElementById('btn-wa');
      btnWa.style.display = 'block';
      btnWa.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_WHATSAPP_TASK', task });
      });
    }
  } else {
    document.getElementById('task-title').textContent = task.title || 'Lembrete Seven Gold';
  }

  // Close Button
  document.getElementById('btn-close').addEventListener('click', () => {
    window.close();
  });

  // Mark as Done Button
  const btnDone = document.getElementById('btn-done');
  btnDone.addEventListener('click', async () => {
    btnDone.disabled = true;
    btnDone.textContent = 'Atualizando...';
    
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_TASK',
        id: task.id,
        status: 'done'
      }, async (response) => {
        await chrome.storage.local.remove(storageKey);
        await chrome.alarms.clear(`sevenGoldTask:${task.id}`);
        window.close();
      });
    } catch (e) {
      console.error('[Seven Gold CRM][Alarm] Erro ao marcar feito:', e);
      window.close();
    }
  });
});
