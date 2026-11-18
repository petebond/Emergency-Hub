'use strict';
/* Data Protection Pack - builds a branded PDF in the browser with jsPDF (static/vendor/jspdf.umd.min.js).
   Everything is generated on this PC; nothing is sent anywhere. General guidance only, not legal advice. */

async function buildDataProtectionPack(state, draft) {
  const { jsPDF } = window.jspdf;
  const st = (draft && draft.settings) || state.settings;
  const centre = Object.assign({}, state.centre || {}, (draft && draft.centre) || {});
  const org = (st.org_name || '').trim() || 'Your organisation';
  const lead = (st.dp_lead_name || '').trim() || '[name of your data protection lead]';
  const leadContact = (st.dp_lead_contact || '').trim() || '[their email or phone]';
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const sec = state.security || {};
  const cs = state.churchsuite || {};
  const contacts = state.contacts || [];
  const hubs = contacts.filter((c) => c.statuses.includes('hub_coordinator')).length;
  const statuses = st.statuses || state.statuses || [];

  // ---- colours from the accent colour (helpers come from app.js)
  const accent = /^#[0-9a-f]{6}$/i.test(st.accent_color || '') ? st.accent_color : '#23395D';
  const ink = contrast(accent, '#FFFFFF') >= contrast(accent, '#111111') ? '#FFFFFF' : '#111111';
  let accentText = accent; let i = 0;
  while (contrast(accentText, '#FFFFFF') < 4.5 && i++ < 20) accentText = mix(accentText, '#000000', 0.12);
  const soft = mix(accent, '#FFFFFF', 0.9);
  const softer = mix(accent, '#FFFFFF', 0.95);

  // ---- logo (any image type -> PNG through a canvas)
  let logo = null;
  const logoUrl = st.show_org_logo !== false && state.images && state.images.org_logo;
  if (logoUrl) {
    try {
      const blob = await (await fetch(logoUrl)).blob();
      const obj = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = obj; });
      let w = img.naturalWidth || 300; let h = img.naturalHeight || 300;
      const k = Math.min(1, 600 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      logo = { data: cv.toDataURL('image/png'), ratio: w / h };
      URL.revokeObjectURL(obj);
    } catch (e) { logo = null; }
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210; const H = 297; const M = 18; const CW = W - 2 * M;
  let y = 0;
  const LH = 4.4;

  let lastFont = ['normal', 9.5];
  const font = (style, size, colour, keep) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(colour || '#1D2330'); if (!keep) lastFont = [style, size, colour]; };
  const header = () => {
    let x = M;
    if (logo) { const h = 8; const w = Math.min(24, h * logo.ratio); doc.addImage(logo.data, 'PNG', M, 9, w, w / logo.ratio); x = M + w + 3; }
    font('bold', 9, accentText, true); doc.text(org, x, 14);
    font('normal', 8, '#667085', true); doc.text('Data Protection Pack - emergency contact planning', W - M, 14, { align: 'right' });
    doc.setDrawColor(accent); doc.setLineWidth(0.6); doc.line(M, 19, W - M, 19);
  };
  const newPage = () => { doc.addPage(); header(); font(...lastFont); y = 28; };  // carry on in the same text style
  const ensure = (h) => { if (y + h > H - 18) newPage(); };
  const gap = (n = 2) => { y += n; };

  const h1 = (t) => {
    ensure(22);
    y += 2;
    doc.setFillColor(accent); doc.roundedRect(M, y - 6, CW, 10, 1.5, 1.5, 'F');
    font('bold', 13, ink); doc.text(t, M + 4, y + 0.8);
    y += 10;
  };
  const h2 = (t) => { ensure(12); y += 1; font('bold', 10.5, accentText); doc.text(t, M, y); y += 5.5; };
  const para = (t, opts = {}) => {
    font(opts.bold ? 'bold' : 'normal', opts.size || 9.5, opts.colour);
    const lines = doc.splitTextToSize(t, opts.width || CW);
    lines.forEach((ln) => { ensure(LH); doc.text(ln, opts.x || M, y); y += LH; });
    y += opts.after ?? 2;
  };
  const bullets = (items, opts = {}) => {
    items.forEach((t) => {
      font('normal', 9.5);
      const lines = doc.splitTextToSize(t, CW - 6);
      ensure(LH * Math.min(lines.length, 2));
      doc.setFillColor(accent); doc.circle(M + 1.6, y - 1.2, 0.8, 'F');
      lines.forEach((ln) => { ensure(LH); doc.text(ln, M + 5, y); y += LH; });
      y += 0.8;
    });
    y += opts.after ?? 1.5;
  };
  const checklist = (items) => {
    items.forEach((t) => {
      font('normal', 9.5);
      const lines = doc.splitTextToSize(t, CW - 8);
      ensure(LH * lines.length + 1);
      doc.setDrawColor('#667085'); doc.setLineWidth(0.3); doc.rect(M, y - 3.2, 3.6, 3.6);
      lines.forEach((ln) => { doc.text(ln, M + 6.5, y); y += LH; });
      y += 1.4;
    });
    y += 1;
  };
  const box = (title, text, opts = {}) => {
    font('normal', 9.5);
    const parts = Array.isArray(text) ? text : [text];
    const lines = [];
    parts.forEach((pt, n) => { doc.splitTextToSize(pt, CW - 10).forEach((l) => lines.push(l)); if (n < parts.length - 1) lines.push(''); });
    const h = 9 + lines.length * LH + (title ? 5 : 0);
    if (h < H - 50) ensure(h + 2);
    const top = y - 4;
    doc.setFillColor(opts.fill || soft); doc.setDrawColor(accent); doc.setLineWidth(0.4);
    doc.roundedRect(M, top, CW, Math.min(h, H - 18 - top), 2, 2, 'FD');
    y += 1.5;
    if (title) { font('bold', 10, accentText); doc.text(title, M + 5, y); y += 6; }
    font('normal', 9.5);
    lines.forEach((ln) => {
      if (y + LH > H - 18) { newPage(); }
      doc.text(ln, M + 5, y); y += LH;
    });
    y += 6;
  };
  const table = (headers, rows, widths, opts = {}) => {
    const total = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / total) * CW);
    const drawHead = () => {
      font('bold', 8.5, ink);
      const hh = Math.max(...headers.map((t, c) => doc.splitTextToSize(t, ws[c] - 3).length)) * 3.8 + 3;
      doc.setFillColor(accent); doc.rect(M, y - 4, CW, hh, 'F');
      let x = M;
      headers.forEach((t, c) => { doc.splitTextToSize(t, ws[c] - 3).forEach((ln, k) => doc.text(ln, x + 1.5, y + k * 3.8)); x += ws[c]; });
      y += hh;
    };
    ensure(16); if (!opts.noHead) drawHead(); else y += 2;
    rows.forEach((row, r) => {
      font('normal', opts.size || 8.8);
      const cells = row.map((t, c) => doc.splitTextToSize(String(t ?? ''), ws[c] - 3));
      const rh = Math.max(opts.minRow || 0, Math.max(...cells.map((l) => l.length)) * 3.9 + 2.6);
      if (y + rh > H - 18) { newPage(); if (!opts.noHead) drawHead(); font('normal', opts.size || 8.8); }
      if (r % 2 === 0) { doc.setFillColor(softer); doc.rect(M, y - 4, CW, rh, 'F'); }
      let x = M;
      cells.forEach((lines, c) => {
        font(c === 0 && opts.boldFirst ? 'bold' : 'normal', opts.size || 8.8);
        lines.forEach((ln, k) => doc.text(ln, x + 1.5, y + k * 3.9));
        x += ws[c];
      });
      doc.setDrawColor('#D0D5DD'); doc.setLineWidth(0.2); doc.line(M, y - 4 + rh, M + CW, y - 4 + rh);
      y += rh;
    });
    y += 4;
  };
  const signLines = (labels) => {
    labels.forEach((l) => {
      ensure(12);
      font('normal', 9.5); doc.text(l, M, y);
      doc.setDrawColor('#98A2B3'); doc.setLineWidth(0.3); doc.line(M + 38, y + 0.5, M + CW, y + 0.5);
      y += 10;
    });
  };

  // ------------------------------------------------------------------ cover page
  doc.setFillColor(accent); doc.rect(0, 0, W, 112, 'F');
  if (logo) {
    const h = 34; const w = Math.min(70, h * logo.ratio); const hh = w / logo.ratio;
    doc.setFillColor('#FFFFFF'); doc.roundedRect(M - 3, 22 - 3, w + 6, hh + 6, 3, 3, 'F');
    doc.addImage(logo.data, 'PNG', M, 22, w, hh);
  }
  font('bold', 13, ink); doc.text(org.toUpperCase(), M, logo ? 76 : 40);
  font('bold', 30, ink); doc.text('Data Protection Pack', M, logo ? 90 : 56);
  font('normal', 12, ink); doc.text('Emergency contact planning - your responsibilities under UK law', M, logo ? 100 : 66);
  y = 128;
  table(['', ''], [
    ['Prepared for', org],
    ['Prepared on', today],
    ['Data protection lead', `${lead} (${leadContact})`],
    ['Central hub', [centre.name, centre.postcode_display || centre.postcode].filter(Boolean).join(', ') || '-'],
    ['Contact list', `${contacts.length} people, ${hubs} hub coordinator${hubs === 1 ? '' : 's'}`],
    ['Data source', cs.configured ? `ChurchSuite (read-only), tags: ${(cs.tags || []).join(', ')}` : 'CSV upload from your database'],
    ['Encryption on this PC', sec.encrypted ? `On (auto-lock ${st.auto_lock_minutes ? st.auto_lock_minutes + ' minutes' : 'off'})` : 'Off - see section 7'],
  ], [32, 68], { boldFirst: true, noHead: true });
  box('About this pack', [
    `${org} uses Emergency Hub Coordinator to plan how people will be contacted in an emergency: who is a hub coordinator, who is in each hub's group, and who may need extra help. Because the list holds personal information, and some of it may be sensitive, ${org} must handle it in line with UK data protection law.`,
    'This pack explains those responsibilities in plain English and gives you ready-to-use material: wording for inviting people to opt in, a privacy notice paragraph, a risk assessment outline, a confidentiality agreement for hub coordinators, and checklists.',
    'It is general guidance, not legal advice. Check your approach against the ICO guidance listed at the end, or with your diocese, denomination, umbrella body or a data protection adviser.',
  ]);
  para('Contents: 1 At a glance  -  2 The law  -  3 Lawful basis and opting in  -  4 What the system holds  -  5 Opt-in wording and privacy notice  -  6 Risk assessment (DPIA)  -  7 Security  -  8 Sharing  -  9 Accuracy and retention  -  10 Rights and complaints  -  11 Data breaches  -  12 Hub coordinator agreement  -  13 Annual review  -  14 References', { size: 8.5, colour: '#667085' });

  // ------------------------------------------------------------------ 1 at a glance
  newPage();
  h1('1. At a glance');
  table(['Question', 'Answer for ' + org], [
    ['Who is responsible?', `${org} is the "data controller" - it decides why and how the information is used, and is accountable for it. ${lead} is the day-to-day lead.`],
    ['Who is included?', 'Only people who have chosen to join the plan (opted in), for example those given an "Emergency Hub" tag in your church database.'],
    ['What is held?', 'Names, addresses, phone numbers and email addresses copied from your church database, the statuses you tick (listed in section 4), hub assignments and any notes.'],
    ['Why?', 'To plan and carry out contact with people in an emergency, and to make sure those who may need extra help are checked on first.'],
    ['Where is it kept?', `On one computer, in the app's data folder. Encryption is ${sec.encrypted ? 'ON' : 'OFF'}. It is not stored online by the software's authors.`],
    ['Who sees it?', 'The people who run the system, and each hub coordinator sees only their own group (on screen or on a printed call list).'],
    ['How long?', 'For as long as the person stays opted in and on your church database. When they withdraw or leave, the next update removes them.'],
    ['Main law', 'UK GDPR, the Data Protection Act 2018 and the Data (Use and Access) Act 2025. Regulator: the Information Commissioner\'s Office (ICO).'],
  ], [30, 70], { boldFirst: true });
  h2('Your first steps');
  checklist([
    `Name a data protection lead (${lead}) and agree who may use the system.`,
    'Decide and write down your lawful basis and special category condition (section 3).',
    'Invite people to opt in using the wording in section 5. Tag those who agree (for example "Emergency Hub" in ChurchSuite) and keep a record of when they agreed.',
    'Add the privacy notice paragraph (section 5) to your existing privacy notice and tell people about it.',
    'Complete the risk assessment (section 6) and have it signed off by your trustees or leadership.',
    sec.encrypted ? 'Encryption is on - keep the passphrase somewhere safe (section 7).' : 'Turn on encryption in Settings > Data & privacy, and keep the passphrase safe (section 7).',
    'Ask each hub coordinator to sign the confidentiality agreement (section 12) before they receive a call list.',
    'Check whether you need to pay the ICO data protection fee (section 2).',
    'Put a date in the diary for the annual review (section 13).',
  ]);

  // ------------------------------------------------------------------ 2 law
  h1('2. The law that applies');
  para('Three pieces of legislation work together:');
  bullets([
    'UK GDPR - the main rules: the data protection principles, lawful bases, people\'s rights and security duties.',
    'Data Protection Act 2018 - adds UK-specific detail, including extra conditions for sensitive ("special category") information.',
    'Data (Use and Access) Act 2025 - updates both, in stages. Among other things it adds "recognised legitimate interests" (including responding to emergencies) and, from 19 June 2026, requires every controller to have a process for handling data protection complaints (section 10).',
  ]);
  h2('The seven principles');
  para('Personal information must be:');
  bullets([
    'used lawfully, fairly and transparently - people should know you hold it and why;',
    'used only for the purposes you have told people about (here, emergency contact planning);',
    'adequate, relevant and limited to what is necessary - no more than you need;',
    'accurate and kept up to date;',
    'kept for no longer than necessary;',
    'kept secure;',
    'and you must be able to show how you comply ("accountability") - keep a record of your decisions.',
  ]);
  h2('The ICO data protection fee');
  para('Most organisations that process personal information must pay an annual fee to the ICO, but there are exemptions. Organisations that are not run for profit can be exempt if they only process information for limited purposes such as running their membership and supporters, subject to conditions. Use the ICO\'s fee self-assessment (see references) to check, and keep a note of the answer.');

  // ------------------------------------------------------------------ 3 lawful basis
  h1('3. Your lawful basis, and opting in');
  para('You need a lawful basis (UK GDPR Article 6) for holding the list at all, and an extra condition (Article 9) for any special category information. Choose them before you start, write them down, and say what they are in your privacy notice.');
  box('We recommend an opt-in', [
    'Caring for people is part of a church\'s purpose, so there is a reasonable argument that you could include everyone on your church list without asking, relying on legitimate interests. However, the plan involves printing people\'s names, addresses and phone numbers and handing them to another member of the church. Best practice is to ask first and include only those who say yes.',
    'An opt-in means people make an informed choice, nobody is surprised to be contacted, and you have a clear record of who agreed and when. It also gives you a simple way to honour a change of mind: remove the opt-in tag and the person is taken off at the next update.',
    cs.configured ? `In ChurchSuite, create a tag called "Emergency Hub", add it only to people who have opted in, and tick only that tag in Settings > Data & privacy. Tags ticked now: ${(cs.tags || []).join(', ') || 'none'}.` : 'Keep a tag, group or column in your church database for people who have opted in (for example "Emergency Hub"), and export only those people when you upload a CSV.',
  ]);
  h2('For the list itself (Article 6)');
  table(['Basis', 'When it fits', 'Notes'], [
    ['Consent, through an opt-in (suggested)', 'People choose to join the plan after being told what will be shared and with whom (section 5).', 'Must be freely given, specific, informed and as easy to withdraw as to give. Keep a record of who agreed, when and what they were told. If someone withdraws, remove them: taking off the opt-in tag does this at the next update.'],
    ['Legitimate interests', 'If you decide to include people without asking, because caring for them is part of your purpose.', 'Do a short legitimate interests assessment: is the purpose legitimate, is the data necessary, and do people\'s interests override it? Record the result. People can object. If you also use an opt-in, it is a safeguard rather than your lawful basis, so say clearly which basis you rely on.'],
    ['Recognised legitimate interest: emergencies', 'Only while responding to an emergency as defined in the Civil Contingencies Act 2004 (e.g. serious flooding, loss of power or water, a major incident).', 'Must be necessary and proportionate. Document what you did and why. Go back to your normal basis afterwards.'],
    ['Vital interests', 'In an emergency when someone\'s life or health is at risk.', 'For urgent situations, not for routine planning.'],
  ], [24, 38, 38], { boldFirst: true });
  h2('Special category information (Article 9)');
  para('Some information needs extra protection: for example health, religious belief, ethnicity and sexual orientation. Two things in this system may be special category:');
  bullets([
    'Statuses that suggest a health condition or disability, such as "Vulnerable". Record the practical need (for example "needs a check-in") rather than a diagnosis, and only where it helps keep the person safe.',
    'For churches and other faith groups, simply being on the list can reveal a person\'s religious belief.',
  ]);
  para('Conditions that commonly fit:');
  table(['Condition', 'What it requires'], [
    ['Not-for-profit bodies - Article 9(2)(d)', 'For a not-for-profit body with a religious, philosophical, political or trade union aim, in the course of its legitimate activities and with appropriate safeguards. It covers members, former members, and people in regular contact with the body for its purposes - and the information must not be shared outside the body without the person\'s consent.'],
    ['Explicit consent - Article 9(2)(a)', 'A clear, recorded "yes" from the person. A clearly worded opt-in (section 5) can cover being on a church\'s list; ask separately before flagging someone as needing extra help. They can withdraw it at any time.'],
    ['Vital interests - Article 9(2)(c)', 'Only when needed to protect someone\'s life and the person is physically or legally unable to consent - for example sharing details with paramedics.'],
  ], [32, 68], { boldFirst: true });
  para('Good practice: ask people (or, with their agreement, a family member or carer) whether they would like to be flagged for extra help, and record that they agreed.', { colour: '#344054' });

  // ------------------------------------------------------------------ 4 what is held
  h1('4. What the system holds and where');
  h2('Information about each person');
  bullets([
    'First and last name, address, postcode, telephone, mobile and email (from your church database).',
    'The position on the map, worked out from the postcode or supplied by ChurchSuite.',
    'Statuses ticked by your team, hub group and hub level, and any notes.',
  ]);
  h2('Statuses currently set up');
  const sensitive = /vulnerab|health|disab|medic|carer|mobility|oxygen|dialysis|mental|illness|frail|impair|blind|deaf|wheelchair|pregnan/i;
  table(['Status', 'Kind of information', 'Take care?'], statuses.map((x) => [
    x.label,
    x.key === 'hub_coordinator' ? 'A role in your emergency plan' : (sensitive.test(x.label) ? 'May reveal health or disability' : 'Role, household or practical information'),
    sensitive.test(x.label) ? 'Yes - treat as special category; record needs, not diagnoses' : 'Standard care',
  ]), [30, 40, 30], { boldFirst: true });
  h2('What leaves this computer');
  bullets([
    'Postcodes (and, if a postcode is not recognised, the street address) are sent to free lookup services (postcodes.io, and OpenStreetMap Nominatim as a fallback) to place people on the map. Names, phone numbers, statuses and notes are never sent.',
    'Map pictures are loaded from OpenStreetMap (or the satellite provider). They contain no personal information.',
    cs.configured ? 'ChurchSuite: the app reads (never changes) contacts with your chosen tags (ideally just your opt-in tag), using a dedicated read-only account.' : 'Contact lists are uploaded as CSV files exported from your database (ideally only people who have opted in).',
    'Nothing is sent to the authors of Emergency Hub Coordinator. There is no online account.',
  ]);

  // ------------------------------------------------------------------ 5 privacy notice
  ensure(120); // keep the heading, the intro and the opt-in form together
  h1('5. Opt-in wording and privacy notice');
  h2('Inviting people to opt in');
  para('Use or adapt this wording on a paper or online form, in your newsletter or in an email. Keep the replies, and record each "yes" in your church database with the date.');
  box('Emergency contact plan - would you like to be included?', [
    `${org} is putting together an emergency contact plan so that, if there is a serious emergency in our area (such as flooding, a long power cut or severe weather), someone from the church who lives near you can check that you are safe and pass on any need for help.`,
    'If you join, the church will hold your name, address, phone numbers and email address securely for this purpose. Your name, address and phone numbers will be printed on a call list and given to a hub coordinator: a church member who lives nearby and has agreed to keep them confidential. In a real emergency we may share the minimum necessary with the emergency services or the council to protect someone\'s life or safety.',
    `Joining is your choice, and you can leave at any time by telling ${lead} (${leadContact}). You will then be removed from the plan and from the call lists when they are next updated.`,
    '[  ]  Yes, please include me in the emergency contact plan. I agree to my details being used and shared as described above.',
    '[  ]  I may need extra help in an emergency (for example with mobility, or because I live alone) and I am happy for my hub coordinator to know this.',
    'Name ..................................................    Date ......................',
  ]);
  newPage();  // the opt-in form gets a page of its own, ready to copy
  h2('Privacy notice paragraph');
  para(`Add this to ${org}'s privacy notice (on your website, in your welcome pack and wherever you collect contact details). Adjust the wording in [square brackets] to match the decisions you made in section 3.`);
  const contactBits = [centre.landline && `phone ${centre.landline}`, centre.email && `email ${centre.email}`].filter(Boolean).join(' or ');
  box('Emergency contact planning', [
    `${org} keeps an emergency contact plan so that, if there is a serious emergency in our area (such as flooding, a long power cut or severe weather), we can check that the people who have chosen to join it are safe and get help to those who need it.`,
    'For this we use your name, address, phone numbers and email address from our church records, together with information about any role you have in the plan (for example as a hub coordinator) and whether you have told us you may need extra help. Your address is used to place you on a map so that you can be contacted by someone who lives nearby.',
    `We only include people who have asked to be included, and we rely on [your consent / our legitimate interests in planning for emergencies, with your agreement as a safeguard]. Where we record that someone may need extra help, we do so [with their agreement / as a not-for-profit religious organisation, for our members and regular contacts]. In a real emergency we may share the minimum necessary information with the emergency services or the local council to protect someone's life or safety.`,
    'Each hub coordinator only sees the details of the people in their own group, and has agreed to keep them confidential. The plan is kept securely on a computer held by the church and is not shared with anyone else. If you leave the plan or our church records, you are removed from it at the next update.',
    `You can leave the plan at any time, ask to see the information we hold about you, or ask us to correct it. Please contact ${lead} (${leadContact})${contactBits ? `, or ${centre.name || 'the church office'} (${contactBits})` : ''}. If you are unhappy with how we have handled your information, please tell us first; you also have the right to complain to the Information Commissioner's Office (ico.org.uk, 0303 123 1113).`,
  ]);

  // ------------------------------------------------------------------ 6 DPIA
  h1('6. Risk assessment (DPIA) outline');
  para('A Data Protection Impact Assessment is required when processing is likely to result in a high risk to people - which can be the case when sensitive information about potentially vulnerable people is involved. Even if you decide one is not strictly required, completing this short assessment is good practice and shows accountability. Add your own risks, decide whether each remaining risk is acceptable, and have it signed off.');
  table(['Risk', 'Possible harm', 'Safeguards in this system', 'Your further action'], [
    ['Computer lost or stolen', 'Contact details and sensitive statuses exposed', sec.encrypted ? 'Data folder encrypted (on); auto-lock; app only reachable from this PC by default' : 'Encryption available but OFF - turn it on; app only reachable from this PC by default', ''],
    ['Printed call list lost', 'Details of a group exposed', 'Lists show only one group, marked confidential, with a shredding reminder', ''],
    ['Hub coordinator misuses details', 'Unwanted contact, loss of trust', 'Each coordinator sees only their group; confidentiality agreement (section 12)', ''],
    ['Out-of-date or wrong information', 'Someone missed in an emergency', 'Regular update from the church database; changes report after every update', ''],
    ['Too much sensitive detail recorded', 'Unnecessary intrusion', 'Statuses are simple flags; guidance to record needs not diagnoses', ''],
    ['Person does not want to be included', 'Loss of trust; objection', 'Opt-in: only people who have agreed are included; removing the opt-in tag takes them off at the next update', ''],
    ['Person did not understand what they agreed to', 'Unexpected contact; loss of trust', 'Opt-in wording says what is shared and with whom; privacy notice; a record of when each person agreed', ''],
    ['Information sent to outside services', 'Addresses seen by third parties', 'Only postcodes/addresses are sent for map positions; no names', ''],
    ['Someone else uses the computer', 'Unauthorised access', sec.encrypted ? 'Passphrase and lock button' : 'Use a separate Windows account; turn on encryption', ''],
  ], [20, 22, 34, 24], { size: 8.2, minRow: 11 });
  h2('Sign-off');
  signLines(['Completed by', 'Approved by', 'Date', 'Review date']);

  // ------------------------------------------------------------------ 7 security
  h1('7. Security checklist');
  checklist([
    sec.encrypted ? 'Encryption of the data folder is ON.' : 'Turn on encryption (Settings > Data & privacy) - it is currently OFF.',
    'The passphrase is at least 12 characters (three or four random words), known only to the people who need it, and stored safely (password manager or sealed envelope). If it is lost, the data cannot be recovered.',
    `Auto-lock is set (currently ${sec.encrypted ? (st.auto_lock_minutes ? st.auto_lock_minutes + ' minutes' : 'never') : 'not applicable'}), and people use the lock button when they step away.`,
    'The computer has its own login, up-to-date software and antivirus, and ideally full-disk encryption (BitLocker on Windows).',
    'The app is only reachable from this computer (the default). If it is opened up to other devices on your network, it is only on a trusted network.',
    'Exported CSV files and printed lists are treated as confidential, stored securely and deleted or shredded when no longer needed.',
    'The ChurchSuite account used by the app is a dedicated, read-only account (if you use ChurchSuite).',
    'Backups of the data folder are themselves kept securely (they contain the same information).',
  ]);

  // ------------------------------------------------------------------ 8 sharing
  h1('8. Sharing information');
  h2('With hub coordinators');
  bullets([
    'Give each coordinator only their own group\'s call list.',
    'Ask them to sign the confidentiality agreement first, to keep the list safe, and to return or shred it when it is replaced.',
    'Do not share lists in group chats or by email to personal accounts. Phone calls and texts to the people on the list are fine - that is the point of the plan.',
  ]);
  h2('With the emergency services or the council');
  bullets([
    'In a real emergency, share the minimum needed to protect people - for example telling the fire service which nearby households include someone who needs help to leave.',
    'Afterwards, write down what was shared, with whom, when and why (a simple decision log is enough).',
    'Do not hand over the whole list "just in case" - share what is needed for the situation.',
  ]);
  h2('Decision log');
  table(['Date', 'Shared with', 'What was shared', 'Why', 'By'], [['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']], [14, 20, 28, 26, 12], { minRow: 10 });

  // ------------------------------------------------------------------ 9 accuracy and retention
  h1('9. Accuracy and how long information is kept');
  bullets([
    `Update the list from your church database regularly${cs.configured ? ' (Sync from ChurchSuite)' : ' (upload a fresh CSV)'}. Each update treats your database as the complete list, so people who have left are removed automatically, and a changes report shows what happened.`,
    'Review statuses and notes at least once a year - for example whether someone still needs extra help - and remove anything no longer needed.',
    'Invite new members to opt in as part of welcoming them, and remove the opt-in tag straight away when someone withdraws.',
    'The app keeps the last 30 automatic backups in the data folder. Delete older copies made elsewhere.',
    'Collect and shred printed call lists after an exercise or emergency, and whenever a new version is issued.',
    'If you stop using the system, delete the data folder (and any backups and exports).',
  ]);

  // ------------------------------------------------------------------ 10 rights and complaints
  h1('10. People\'s rights and complaints');
  para('People have the right to: be told how their information is used (the privacy notice); see a copy of it; have it corrected; have it deleted in some circumstances; object to its use; and restrict its use while a concern is looked at. Respond to requests within one month.');
  bullets([
    'To find someone\'s information quickly, use Table view (search by name) or open their contact card. Export CSV gives a copy of everything held.',
    'If someone withdraws or asks not to be included, remove the opt-in tag in your church database (or remove them from the upload) and note their request. They are removed at the next update.',
  ]);
  h2('Complaints - required from 19 June 2026');
  para('The Data (Use and Access) Act 2025 requires controllers to make it easy to complain about how personal information is handled. In practice:');
  checklist([
    'Tell people how to complain (in the privacy notice) and accept complaints however they arrive.',
    'Acknowledge each complaint within 30 days.',
    'Look into it without undue delay, keep the person updated, and tell them the outcome.',
    'Tell them they can also complain to the ICO (ico.org.uk, 0303 123 1113).',
  ]);

  // ------------------------------------------------------------------ 11 breaches
  h1('11. If something goes wrong');
  para('A personal data breach is any loss, theft, unauthorised access to or accidental disclosure of personal information - for example a lost printed call list, a stolen laptop, or a list emailed to the wrong person.');
  checklist([
    'Contain it straight away: recover the list, change the passphrase, ask a recipient to delete an email.',
    'Tell the data protection lead and record it in a breach log - every breach, however small.',
    'Assess the risk to the people affected. If it is likely to put their rights and freedoms at risk, report it to the ICO within 72 hours of becoming aware of it.',
    'If the risk to people is high, tell them too, so they can protect themselves.',
    'Learn from it: what will you change so it does not happen again?',
  ]);
  h2('Breach log');
  table(['Date', 'What happened', 'People affected', 'Action taken', 'Reported to ICO?'], [['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']], [12, 30, 18, 28, 12], { minRow: 10 });

  // ------------------------------------------------------------------ 12 agreement
  newPage();
  h1('12. Hub coordinator confidentiality agreement');
  para(`Thank you for agreeing to be a hub coordinator for ${org}. You will be given the names, addresses and phone numbers of the people in your group, and sometimes a note that someone may need extra help. Please read and sign this agreement before you receive your call list.`);
  para('I agree that I will:', { bold: true });
  bullets([
    `use the information only to contact and help people as part of ${org}'s emergency plan;`,
    'keep my call list safe and private - not leave it where others can read it, not photograph it, and not share it in group chats, social media or by email;',
    'only share information with the emergency services or the council when needed to protect someone, and tell the data protection lead afterwards;',
    `tell ${lead} straight away if my list is lost or seen by someone who should not see it;`,
    'return or shred my list when I am given a new one or stop being a hub coordinator;',
    `contact ${centre.name || 'the central hub'}${contactBits ? ` (${contactBits})` : ''} to report back during an emergency.`,
  ]);
  gap(4);
  signLines(['Name', 'Signature', 'Date', `For ${org}`]);

  // ------------------------------------------------------------------ 13 annual review
  h1('13. Annual review checklist');
  checklist([
    'The lawful basis and special category condition are still right, and written down.',
    'The privacy notice is up to date and easy to find.',
    'Everyone on the list has opted in, records of when they agreed are kept, and newcomers have been invited.',
    'Statuses and notes are still needed and accurate; anything unnecessary has been removed.',
    'Hub coordinators are still willing, have signed the agreement, and have current lists; old lists have been shredded.',
    'Encryption is on, the passphrase is safely stored, and the right people know how to unlock the app.',
    'The risk assessment has been reviewed and signed off.',
    'Any breaches and complaints from the year have been dealt with and lessons applied.',
    'The ICO fee position has been checked.',
  ]);
  signLines(['Reviewed by', 'Date', 'Next review']);

  // ------------------------------------------------------------------ 14 references
  h1('14. References');
  para('ICO (Information Commissioner\'s Office) guidance - ico.org.uk:', { bold: true, after: 1 });
  bullets([
    'UK GDPR guidance and resources: ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources',
    'Lawful basis and legitimate interests (including recognised legitimate interests and the emergencies condition)',
    'Special category data and the conditions for processing',
    'Data protection impact assessments (DPIAs)',
    'Personal data breaches - reporting within 72 hours',
    'Handling data protection complaints (Data (Use and Access) Act 2025)',
    'The data protection fee - self-assessment',
    'ICO helpline: 0303 123 1113',
  ]);
  para('Legislation: UK GDPR; Data Protection Act 2018; Data (Use and Access) Act 2025; Civil Contingencies Act 2004 (definition of an emergency). See legislation.gov.uk.', { colour: '#344054' });
  gap(4);
  box(null, `This pack was generated by Emergency Hub Coordinator on ${today} from ${org}'s own settings. It is general guidance and not legal advice; laws and ICO guidance change, so check the current guidance when you review it.`, { fill: softer });

  // ---- footers with page numbers
  const n = doc.getNumberOfPages();
  for (let pg = 1; pg <= n; pg++) {
    doc.setPage(pg);
    font('normal', 7.5, '#667085');
    doc.text(`${org} - Data Protection Pack - ${today}`, M, H - 9);
    doc.text(`Page ${pg} of ${n}`, W - M, H - 9, { align: 'right' });
  }
  const slug = org.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Organisation';
  doc.save(`Data-Protection-Pack-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
