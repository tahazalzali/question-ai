(() => {
  const startForm = document.getElementById('start-form');
  const queryInput = document.getElementById('query');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');

  const modal = document.getElementById('modal');   
  const modalTitle = document.getElementById('modal-title');
  const modalOptions = document.getElementById('modal-options');
  const modalClose = document.getElementById('modal-close');

  const spinner = document.getElementById('spinner');
  const spinnerTextEl = document.getElementById('spinner-text');

  let sessionId = null;
  let spinnerInterval = null;
  const spinnerMessages = [
    'Searching…',
    'Extracting data…',
    'Merging sources…',
    'Ranking candidates…',
    'Finalizing results…',
  ];

  function showSpinner(show) {
    if (show) {
      spinner.hidden = false;
      let idx = 0;
      spinnerTextEl.textContent = spinnerMessages[idx];
      clearInterval(spinnerInterval);
      spinnerInterval = setInterval(() => {
        idx = (idx + 1) % spinnerMessages.length;
        spinnerTextEl.textContent = spinnerMessages[idx];
      }, 1200);
    } else {
      spinner.hidden = true;
      if (spinnerInterval) clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  }

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  function clearResults() {
    resultsEl.innerHTML = '';
  }

  function showModal(title, options, onSelect) {
    modalTitle.textContent = title || 'Choose an option';
    modalOptions.innerHTML = '';

    (options || []).forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.textContent = opt.label || opt.value || opt.id;
      btn.addEventListener('click', async () => {
        closeModal();
        onSelect(opt);
      });
      modalOptions.appendChild(btn);
    });

    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
  }

  modalClose.addEventListener('click', () => closeModal());

  function asArray(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (v === null || v === undefined || v === '') return [];
    return [v];
  }

  function linkifyEmail(email) {
    const e = (email || '').trim();
    return `<a href="mailto:${e}">${e}</a>`;
  }
  function linkifyPhone(phone) {
    const raw = (phone || '').replace(/\s+/g, '');
    const tel = raw.startsWith('+') ? raw : `+${raw}`;
    return `<a href="tel:${tel}">${tel}</a>`;
  }
  function socialLinks(social) {
    if (!social) return '';
    const entries = Object.entries(social)
      .filter(([_, v]) => !!v)
      .map(([k, v]) => `<a href="${v}" target="_blank" rel="noopener noreferrer">${k}</a>`);
    if (!entries.length) return '';
    return `<p class="result-links">Links: ${entries.join(' • ')}</p>`;
  }

  function chipsHtml(values) {
    if (!values?.length) return '—';
    return `<ul class="chips">${values.map(v => `<li class="chip">${v}</li>`).join('')}</ul>`;
  }

  function sourceProviderLabel(provider) {
    return (provider || '').replace(/\b\w/g, c => c.toUpperCase());
  }

  function renderSources(parent, sources) {
    const filtered = (sources || [])
      .filter(src => src?.url && (src.provider || '').toLowerCase() === 'perplexity');
    if (!filtered.length) return;

    const row = document.createElement('div');
    row.className = 'kv';

    const label = document.createElement('span');
    label.className = 'k';
    label.textContent = 'Sources';

    const value = document.createElement('span');
    value.className = 'v';

    const list = document.createElement('ul');
    list.className = 'sources';

    filtered.forEach(src => {
      const item = document.createElement('li');

      const link = document.createElement('a');
      link.className = 'source-provider';
      link.href = src.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent =
        src.url ? src.url :"Source"

      item.appendChild(link);

      if (src.note) {
        const note = document.createElement('span');
        note.className = 'source-note';
        note.textContent = ` – ${src.note}`;
        item.appendChild(note);
      }

      list.appendChild(item);
    });

    value.appendChild(list);
    row.appendChild(label);
    row.appendChild(value);
    parent.appendChild(row);
  }

  function renderResults(payload) {
    clearResults();
    if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
      resultsEl.innerHTML = `<div class="result-card"><p class="result-meta">No results.</p></div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    payload.results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'result-card';

      const title = document.createElement('h3');
      title.className = 'result-title';
      title.textContent = r.fullName || '(unknown)';

      // Normalize fields to arrays when useful
      const professions = asArray(r.profession || r.professions);
      const locations = asArray(r.location || r.locations);
      const employers = asArray(r.employer || r.employers);
      const education = asArray(r.education);
      const emails = asArray(r.emails);
      const phones = asArray(r.phones);
      const confidence = typeof r.confidence === 'number' ? r.confidence : null;
      const sources = Array.isArray(r.sources) ? r.sources : [];

      const section = document.createElement('div');
      section.innerHTML = `
        <div class="kv"><span class="k">Profession</span><span class="v">${chipsHtml(professions)}</span></div>
        <div class="kv"><span class="k">Location</span><span class="v">${chipsHtml(locations)}</span></div>
        <div class="kv"><span class="k">Employer</span><span class="v">${chipsHtml(employers)}</span></div>
        <div class="kv"><span class="k">Education</span><span class="v">${chipsHtml(education)}</span></div>
        <div class="kv"><span class="k">Emails</span><span class="v">${
          emails.length ? emails.map(linkifyEmail).join(' • ') : '—'
        }</span></div>
        <div class="kv"><span class="k">Phones</span><span class="v">${
          phones.length ? phones.map(linkifyPhone).join(' • ') : '—'
        }</span></div>
        <div class="kv"><span class="k">Confidence</span>
          <span class="v">
            ${confidence !== null
              ? `<div class="meter"><span style="width:${Math.round(confidence * 100)}%"></span></div>
                 <span class="result-meta">${Math.round(confidence * 100)}%</span>`
              : '—'}
          </span>
        </div>
      `;

      const social = document.createElement('div');
      social.innerHTML = socialLinks(r.social || {});

      // Related people, if any
      const related = Array.isArray(r.relatedPeople) ? r.relatedPeople : [];
      if (related.length) {
        const relDiv = document.createElement('div');
        relDiv.className = 'kv';
        const label = document.createElement('span');
        label.className = 'k';
        label.textContent = 'Related';
        const val = document.createElement('span');
        val.className = 'v';
        val.innerHTML = related
          .slice(0, 6)
          .map(p =>
            p.linkedin
              ? `<a href="${p.linkedin}" target="_blank" rel="noopener noreferrer">${p.fullName}</a>`
              : `<span class="chip">${p.fullName}</span>`,
          )
          .join(' ');
        relDiv.appendChild(label);
        relDiv.appendChild(val);
        section.appendChild(relDiv);
      }

      renderSources(section, sources);

      card.appendChild(title);
      card.appendChild(section);
      if (social.textContent || social.innerHTML) card.appendChild(social);

      frag.appendChild(card);
    });
    resultsEl.appendChild(frag);
  }

  async function handleQuestion(q) {
    if (!q) return;
    if (q.questionId === 'done') {
      renderResults(q);
      setStatus(`Done. Results: ${q.results?.length || 0}${q.cacheUsed ? ' (cache)' : ''}`);
      return;
    }
    if (q.questionId === 'no_match') {
      renderResults({ results: [] });
      setStatus('No match based on the provided answers.');
      return;
    }

    const opts = (q.options || []).map(o => ({ id: o.id, label: o.label || o.value || o.id }));
    return new Promise(resolve => {
      showModal(q.title, opts, async (selected) => {
        try {
          showSpinner(true);
          const resp = await fetch('/api/ai/next', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              answer: { questionId: q.questionId, selected: selected.id }
            }),
          });
          const data = await resp.json();
          showSpinner(false);
          resolve(await handleQuestion(data));
        } catch (e) {
          console.error(e);
          showSpinner(false);
          setStatus('Failed to fetch next question.');
          resolve();
        }
      });
    });
  }

  startForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearResults();
    setStatus('');
    const query = (queryInput.value || '').trim();
    if (!query) return;

    try {
      showSpinner(true);
      const resp = await fetch('/api/ai/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await resp.json();
      showSpinner(false);

      if (!resp.ok) {
        setStatus(data?.error || 'Failed to start session');
        return;
      }

      sessionId = data.sessionId;
      setStatus(`Session started: ${sessionId}`);
      await handleQuestion(data.question);
    } catch (err) {
      console.error(err);
      showSpinner(false);
      setStatus('Failed to start session.');
    }
  });
})();