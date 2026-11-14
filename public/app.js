const $ = s => document.querySelector(s);
const content = $('#content'), guildSelect = $('#guild-select');
let me = null, guilds = [], currentGuild = '', channels = [], settings = null;
const pageInfo = {
 overview:['Control center','Everything you need to run your community, in one place.'],
 servers:['Server selection','Choose a server you are authorized to manage.'],
 channels:['Channel manager','Connect each ZERON module to the right channel.'],
 welcome:['Welcome system','Make every new member feel like they belong.'],
 leveling:['XP & leveling','Reward participation and keep your community active.'],
 rewards:['Level rewards','Give roles automatically as members level up.'],
 announcements:['Announcements','Schedule messages in each server\'s own time zone.'],
 events:['Event Management','Create events, manage registration, and track participants and staff.'],
 'my-rank':['My rank card','Pick a background for your /rank card.'],
 'embed-builder':['Embed builder','Build an embed, add a divider with --- and an optional image.'],
 'jail':['Jail','Pick the role /jail gives. Only the server owner can use /jail and /unjail.'],
 stats:['Stats channels','Show live member counts in voice channel names.'],
 onboarding:['Onboarding','Welcome new members with rules and role picks.'],
 verification:['Verification','New members apply, staff approve, and roles update automatically.'],
 autorole:['Auto-role on join','Give roles to new members automatically when they join.'],
 'reaction-roles':['Reaction roles','Give roles when members react to a message.'],
 commands:['Custom commands','Text and embed replies for your server, plus an embed builder.'],
 giveaways:['Giveaways','Prizes members can win by pressing a button.'],
 automod:['Auto moderation','Remove bad words, links and mention spam automatically.'],
 birthdays:['Birthdays','Wish members a happy birthday automatically.'],
 tickets:['Tickets','Open private support channels from a button.'],
 'bot-status':['Bot status','Set the bot’s text and status for every server.'],
 analytics:['Analytics','Track XP, economy, and moderation activity.'],
 roles:['Roles & permissions','Review role hierarchy and keep access safe.'],
 logs:['Bot logs','Review recent moderation actions recorded by ZERON.'],
 settings:['General settings','Tune ZERON behavior for this server.'],
};
const navButtons = [...document.querySelectorAll('[data-page]')];
function toast(msg, error=false){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden','error');if(error)t.classList.add('error');setTimeout(()=>t.classList.add('hidden'),4200)}
async function api(url, options={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function discordMarkdown(source=''){
  let text=escapeHtml(String(source||'')).replace(/\r\n?/g,'\n');
  const blocks=[];
  text=text.replace(/\x60{3}([\w+-]*)[ \t]*\n?([\s\S]*?)\x60{3}/g,(_,lang,body)=>{
    const token='@@DISCORD_BLOCK_'+blocks.length+'@@';
    blocks.push('<pre class="discord-code">'+(lang?'<span class="discord-code-language">'+escapeHtml(lang)+'</span>':'')+'<code>'+body.replace(/\n$/,'')+'</code></pre>');
    return token;
  });
  const inlineCode=[];
  text=text.replace(/\x60([^\x60\n]+)\x60/g,(_,body)=>{
    const token='@@DISCORD_INLINE_'+inlineCode.length+'@@';
    inlineCode.push('<code class="discord-inline-code">'+body+'</code>');
    return token;
  });
  const inline=value=>{
    let s=value;
    s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>'<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+label+'</a>');
    s=s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g,'$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s=s.replace(/&lt;@!?(\d{5,})&gt;/g,'<span class="discord-mention">@ExampleMember</span>');
    s=s.replace(/&lt;@&amp;(\d{5,})&gt;/g,'<span class="discord-mention">@ExampleRole</span>');
    s=s.replace(/&lt;#(\d{5,})&gt;/g,'<span class="discord-mention">#example-channel</span>');
    s=s.replace(/&lt;t:(\d{9,})(?::([tTdDfFR]))?&gt;/g,(_,stamp,style)=>{
      const date=new Date(Number(stamp)*1000);
      if(Number.isNaN(date.getTime()))return 'timestamp';
      const format=style||'f';
      if(format==='R'){
        const seconds=Math.round((date.getTime()-Date.now())/1000),units=[['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60],['second',1]];
        const [unit,size]=units.find(([,size])=>Math.abs(seconds)>=size)||units[units.length-1];
        return '<time class="discord-timestamp">'+new Intl.RelativeTimeFormat(undefined,{numeric:'auto'}).format(Math.round(seconds/size),unit)+'</time>';
      }
      const formatters={t:()=>date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}),T:()=>date.toLocaleTimeString(),d:()=>date.toLocaleDateString(),D:()=>date.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}),f:()=>date.toLocaleString(),F:()=>date.toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'})};
      return '<time class="discord-timestamp">'+escapeHtml((formatters[format]||formatters.f)())+'</time>';
    });
    s=s.replace(/&lt;:([a-zA-Z0-9_]+):(\d{5,})&gt;/g,'<span class="discord-custom-emoji">:$1:</span>');
    s=s.replace(/&lt;a:([a-zA-Z0-9_]+):(\d{5,})&gt;/g,'<span class="discord-custom-emoji">:$1:</span>');
    s=s.replace(/@(everyone|here)\b/g,'<span class="discord-everyone">@$1</span>');
    s=s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
    s=s.replace(/___(.+?)___/g,'<strong><em><span class="discord-underline">$1</span></em></strong>');
    s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    s=s.replace(/__(.+?)__/g,'<span class="discord-underline">$1</span>');
    s=s.replace(/~~(.+?)~~/g,'<del>$1</del>');
    s=s.replace(/\|\|(.+?)\|\|/g,'<span class="discord-spoiler" role="button" tabindex="0" aria-label="Spoiler — activate to reveal">$1</span>');
    s=s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
    s=s.replace(/@@DISCORD_INLINE_(\d+)@@/g,(_,i)=>inlineCode[Number(i)]||'');
    return s;
  };
  const lines=text.split('\n'),rendered=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^@@DISCORD_BLOCK_\d+@@$/.test(line)){rendered.push(line);continue;}
    if(/^\s*---\s*$/.test(line)){rendered.push('<hr class="discord-divider">');continue;}
    const heading=line.match(/^(#{1,3})\s+(.+)$/);
    if(heading){rendered.push('<div class="discord-heading discord-heading-'+heading[1].length+'">'+inline(heading[2])+'</div>');continue;}
    if(/^>>>\s?/.test(line)){
      const quote=[line.replace(/^>>>\s?/,'')];
      while(i+1<lines.length)quote.push(lines[++i]);
      rendered.push('<blockquote class="discord-quote discord-quote-multiline">'+quote.map(inline).join('<br>')+'</blockquote>');
      continue;
    }
    if(/^>\s?/.test(line)){
      const quote=[];
      while(i<lines.length&&/^>\s?/.test(lines[i]))quote.push(lines[i++].replace(/^>\s?/,''));
      i--;
      rendered.push('<blockquote class="discord-quote">'+quote.map(inline).join('<br>')+'</blockquote>');
      continue;
    }
    if(/^\s*(?:[-*+]|\d+\.)\s+/.test(line)){
      const ordered=/^\s*\d+\.\s+/.test(line),tag=ordered?'ol':'ul',items=[];
      while(i<lines.length&&new RegExp('^\\s*(?:'+(ordered?'\\d+\\.':'[-*+]')+')\\s+').test(lines[i])){
        items.push('<li>'+inline(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/,''))+'</li>');i++;
      }
      i--;
      rendered.push('<'+tag+' class="discord-list">'+items.join('')+'</'+tag+'>');
      continue;
    }
    rendered.push(line?inline(line):'');
  }
  return rendered.join('<br>').replace(/@@DISCORD_BLOCK_(\d+)@@/g,(_,i)=>blocks[Number(i)]||'');
}
function discordPreviewHtml(value='',area=null){
  const id=area?.id||area?.name||'';
  const sampleServer=guilds.find(g=>g.id===currentGuild)?.name||'Your Server';
  const message=String(value||'')
    .replaceAll('{user}','@ExampleMember').replaceAll('{username}','ExampleMember')
    .replaceAll('{server}',sampleServer).replaceAll('{level}','12')
    .replaceAll('{reward}','Member role').replaceAll('{users}','@ExampleMember');
  const fieldValue=selector=>content.querySelector(selector)?.value?.trim()||'';
  const titleMap={
    'eb-desc':'#eb-title','cc-content':'#cc-title','tk-panel-desc':'#tk-panel-title',
    'vf-panel-message':'#vf-title','ann-body':'#ann-title','gw-desc':'#gw-title'
  };
  const title=fieldValue(titleMap[id]||'')||(area?.classList.contains('ob-text')?area.closest('.field')?.previousElementSibling?.querySelector('.ob-title')?.value?.trim()||'':'');
  const isEmbed=id==='eb-desc'||(id==='cc-content'&&fieldValue('#cc-kind')==='embed')||
    (id==='ann-body'&&content.querySelector('#ann-embed')?.checked)||id==='gw-desc'||id==='bd-message'||id==='levelup_message';
  const isTicket=id==='tk-panel-desc';
  const isVerify=id==='vf-panel-message';
  const isOnboarding=area?.classList.contains('ob-text');
  const isDm=id==='vf-approve-message'||id==='vf-reject-message';
  const label=isDm?'DIRECT MESSAGE PREVIEW':isEmbed?'EMBED PREVIEW':isTicket?'TICKET PANEL PREVIEW':isVerify?'VERIFICATION PREVIEW':isOnboarding?'ONBOARDING STEP PREVIEW':'DISCORD MESSAGE PREVIEW';
  const body=message.trim()?discordMarkdown(message):'<span class="discord-placeholder">Your message will appear here…</span>';
  const contentHtml=isEmbed
    ? '<div class="discord-embed-preview"><div class="discord-embed-accent"></div><div class="discord-embed-inner">'+(title?'<div class="discord-embed-title">'+escapeHtml(title)+'</div>':'')+'<div class="discord-embed-description">'+body+'</div><div class="discord-embed-footer">ZERON • '+escapeHtml(sampleServer)+'</div></div></div>'
    : isTicket||isVerify||isOnboarding
      ? '<div class="discord-panel-preview">'+(title?'<div class="discord-panel-title">'+escapeHtml(title)+'</div>':'')+'<div class="discord-panel-body">'+body+'</div><div class="discord-panel-actions"><span>▣ '+(isTicket?'Open a ticket':isVerify?'Start verification':'Continue')+'</span></div></div>'
      : '<div class="discord-message-content">'+body+'</div>';
  return '<div class="discord-preview"><div class="discord-preview-top"><span class="discord-preview-label">'+label+'</span><div class="discord-preview-tools"><span class="discord-preview-live"><i></i> LIVE</span><button type="button" class="discord-preview-toggle" aria-expanded="true">Hide Preview</button></div></div><div class="discord-preview-content"><div class="discord-message"><div class="discord-avatar"><img src="/images/zeron-logo.png" alt="ZERON logo"></div><div class="discord-message-body"><div class="discord-message-meta"><strong>ZERON</strong><span class="discord-bot-tag">BOT</span><time>Now</time></div>'+contentHtml+'</div></div></div></div>';
}
function attachDiscordPreviews(){
  const areas=[...content.querySelectorAll('textarea')].filter(area=>area.id!=='am-words');
  areas.forEach((area,index)=>{
    if(area.dataset.discordPreviewAttached==='1')return;
    const host=area.closest('.field')||area.parentElement;
    if(!host)return;
    const id=area.id||area.name||'message-'+index;
    area.dataset.discordPreviewAttached='1';
    const preview=document.createElement('div');
    preview.className='discord-preview-host';
    preview.dataset.previewFor=id;
    const refresh=()=>{
      preview.innerHTML=discordPreviewHtml(area.value,area);
      const collapsed=preview.dataset.previewCollapsed==='true';
      const body=preview.querySelector('.discord-preview-content');
      const toggle=preview.querySelector('.discord-preview-toggle');
      if(body)body.hidden=collapsed;
      if(toggle){toggle.textContent=collapsed?'View Preview':'Hide Preview';toggle.setAttribute('aria-expanded',String(!collapsed));}
    };
    preview.addEventListener('click',event=>{
      const spoiler=event.target.closest('.discord-spoiler');
      if(spoiler){spoiler.classList.toggle('is-revealed');return;}
      const toggle=event.target.closest('.discord-preview-toggle');
      if(!toggle)return;
      preview.dataset.previewCollapsed=preview.dataset.previewCollapsed==='true'?'false':'true';
      refresh();
    });
    preview.addEventListener('keydown',event=>{
      if((event.key==='Enter'||event.key===' ')&&event.target.matches('.discord-spoiler')){
        event.preventDefault();event.target.classList.toggle('is-revealed');
      }
    });
    refresh();
    host.insertAdjacentElement('afterend',preview);
    area.addEventListener('input',refresh);
    const titleSelector={
      'eb-desc':'#eb-title','cc-content':'#cc-title','tk-panel-desc':'#tk-panel-title',
      'vf-panel-message':'#vf-title','ann-body':'#ann-title','gw-desc':'#gw-title'
    }[id];
    if(titleSelector){
      const titleField=content.querySelector(titleSelector);
      titleField?.addEventListener('input',refresh);
    }
    if(id==='cc-content'){
      content.querySelector('#cc-kind')?.addEventListener('change',refresh);
    }
    if(id==='ann-body'){
      content.querySelector('#ann-embed')?.addEventListener('change',refresh);
    }
    if(area.classList.contains('ob-text')){
      area.closest('.field')?.previousElementSibling?.querySelector('.ob-title')?.addEventListener('input',refresh);
    }
  });
}
function selectOptions(selected=''){return `<option value="">— Not configured —</option>`+channels.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}># ${escapeHtml(c.name)}</option>`).join('')}
function field(label,name,value='',type='text',extra=''){return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value??'')}" ${extra}></div>`}
function channelField(label,name){return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${selectOptions(settings?.[name]||'')}</select></div>`}
function multiSummary(ids){
  const chips=ids.map(id=>channels.find(c=>c.id===id)).filter(Boolean).map(c=>`<span class="nx-chip"># ${escapeHtml(c.name)}</span>`).join('');
  return chips||'<span class="nx-chip-empty">All channels (no restriction)</span>';
}
function multiChannelField(label,name,rawIds){
  let selected=[];
  try{const parsed=JSON.parse(rawIds||'[]');if(Array.isArray(parsed))selected=parsed}catch{}
  const options=channels.map(c=>`<label class="nx-dropdown-option nx-check"><input type="checkbox" name="${name}" value="${c.id}" ${selected.includes(c.id)?'checked':''}><span># ${escapeHtml(c.name)}</span></label>`).join('')||'<div class="nx-dropdown-option muted">No text channels found</div>';
  return `<div class="field"><label>${label}</label><div class="nx-select-wrap nx-multi"><button type="button" class="nx-dropdown-trigger nx-multi-trigger" aria-haspopup="listbox" aria-expanded="false"><span class="nx-multi-label">${multiSummary(selected)}</span><span class="nx-dropdown-arrow" aria-hidden="true">⌄</span></button><div class="nx-dropdown-menu nx-multi-menu" role="listbox" aria-multiselectable="true">${options}</div></div><small class="muted">Leave all unchecked to allow XP in every channel.</small></div>`;
}
function moduleToggles(s){
  const mods=[
    ['module_xp','XP & leveling','Rank card, leaderboard, and XP earning.'],
    ['module_economy','Economy','Pay, profile, inventory, and coins.'],
    ['module_fishing','Fishing','The /fish command and fishing inventory.'],
    ['module_games','Games','The /play slots game.'],
    ['module_welcome','Welcome messages','Sends the welcome message when members join.'],
    ['module_invites','Invite tracking','Records which invite a member joined with.']
  ];
  return mods.map(([n,l,d])=>toggle(l,d,n,Number(s[n])!==0)).join('');
}
function toggle(label,desc,name,on){return `<div class="toggle-row"><div><b>${label}</b><small>${desc}</small></div><input class="switch" type="checkbox" id="${name}" name="${name}" ${on?'checked':''}></div>`}
function panel(title,desc,body,button=true){return `<div class="panel card"><h3>${title}</h3><p>${desc}</p>${body}${button?'<button class="btn primary save-btn">Save changes →</button>':''}${activePage==='leveling'?'<button type="button" class="btn primary" id="test-levelup-btn" style="margin-left:10px">Test Level-Up</button>':''}${activePage==='welcome'?'<button type="button" class="btn primary" id="test-welcome-btn" style="margin-left:10px">Test Welcome</button>':''}</div>`}
function noGuild(){content.innerHTML=`<div class="panel card empty"><div class="empty-icon">◈</div><h3>Select a connected server</h3><p>Choose a server from the selector above. You need Manage Server or Administrator permission, and ZERON must already be installed there.</p><button class="btn primary" data-page="servers">Choose server →</button></div>`}
async function loadGuilds(){try{const d=await api('/api/me/guilds');guilds=d.guilds;guildSelect.innerHTML='<option value="">Select a server</option>'+guilds.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}${g.installed?'':' (bot not installed)'}</option>`).join('');$('#stat-servers').textContent=guilds.filter(g=>g.installed).length;$('#stat-bot').textContent='Connected';}catch(e){guildSelect.innerHTML='<option value="">Could not load servers</option>';toast(e.message||'Could not load Discord servers. Please reconnect.',true);$('#login-btn').classList.remove('hidden');}}
async function loadGuildData(){if(!currentGuild){settings=null;channels=[];return}const [g,c]=await Promise.all([api(`/api/guild/${currentGuild}`),api(`/api/guild/${currentGuild}/channels`)]);settings=g.settings;channels=c.channels}
function saveButton(){document.querySelectorAll('.save-btn').forEach(b=>b.addEventListener('click',async()=>{if(!currentGuild)return toast('Choose a server first.',true);const patch={};document.querySelectorAll('#content [name]').forEach(el=>{if(el.name==='xp_channel_ids'&&el.type==='checkbox'){if(!Array.isArray(patch.xp_channel_ids))patch.xp_channel_ids=[];if(el.checked)patch.xp_channel_ids.push(el.value)}else if(el.type==='checkbox')patch[el.name]=el.checked;else if(el.type==='number')patch[el.name]=Number(el.value);else if(el.tagName==='SELECT'&&el.multiple)patch[el.name]=Array.from(el.selectedOptions).map(option=>option.value);else patch[el.name]=el.value});b.disabled=true;b.textContent='Saving…';try{const d=await api(`/api/guild/${currentGuild}/settings`,{method:'PUT',body:JSON.stringify(patch)});settings=d.settings;toast('Settings saved successfully. ZERON will use them immediately.');renderPage(activePage)}catch(e){toast(e.message,true)}finally{b.disabled=false;b.textContent='Save changes →'}}))}
let activePage='overview';


async function renderTestingLab(){
  if(!me){
    content.innerHTML = `<div class="panel card empty"><h3>Connect Discord first</h3><p>Sign in to use real Discord test messages.</p><button class="btn primary" data-action="connect-discord">Connect Discord →</button></div>`;
    return;
  }
  if(!currentGuild){
    content.innerHTML = `<div class="panel card empty"><h3>Select a server</h3><p>Choose a server where ZERON is installed before sending tests.</p><button class="btn primary" data-page="servers">Choose server</button></div>`;
    return;
  }

  content.innerHTML = `<div class="panel card testing-lab">
    <div class="eyebrow">ZERON / LIVE TESTING</div>
    <h2>Testing Lab <span style="color:#8FDCFF">.</span></h2>
    <p class="muted">Buttons send actual messages to the selected Discord channel. Sample tests do not change XP.</p>
    <div class="field"><label for="test-channel">Destination channel</label><select id="test-channel"><option value="">Loading channels…</option></select></div>
    <div class="field"><label for="test-custom-message">Custom test message</label><textarea id="test-custom-message" maxlength="1800" placeholder="Write a message to send to the selected channel…"></textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
    <div class="testing-send-grid">
      <button class="btn primary" data-send-test="welcome">📢 Send Welcome Test</button>
      <button class="btn primary" data-send-test="levelup">🏆 Send Level-Up Test</button>
      <button class="btn primary" data-send-test="rank">🪪 Send Rank Card PNG</button>
      <button class="btn primary" data-send-test="leaderboard">📊 Send Leaderboard Test</button>
      <button class="btn" data-send-test="custom">📨 Send Custom Message</button>
    </div>
    <p id="testing-send-status" class="muted" role="status" aria-live="polite" style="margin-top:18px"></p>
    <p class="muted" style="font-size:12px">Only sends when you press a button. Verify the channel before sending.</p>
  </div>`;

  const select = document.querySelector('#test-channel');
  const status = document.querySelector('#testing-send-status');

  try {
    const data = await api(`/api/guild/${currentGuild}/channels`);
    select.innerHTML = `<option value="">— Select a channel —</option>` +
      data.channels.map(c=>`<option value="${escapeHtml(c.id)}"># ${escapeHtml(c.name)}</option>`).join('');
  } catch(e) {
    select.innerHTML = `<option value="">Could not load channels</option>`;
    status.textContent = e.message;
    return;
  }

  content.querySelectorAll('[data-send-test]').forEach(button=>{
    button.addEventListener('click', async ()=>{
      const channelId = select.value;
      if(!channelId){
        status.textContent = 'Choose a destination channel first.';
        return;
      }

      const type = button.dataset.sendTest;
      const message = document.querySelector('#test-custom-message').value;
      if(type==='custom' && !message.trim()){
        status.textContent = 'Write a custom message first.';
        return;
      }

      const channelName = select.options[select.selectedIndex]?.textContent || 'selected channel';
      if(!confirm(`Send this ${type} test to ${channelName}?`)) return;

      button.disabled = true;
      status.textContent = 'Sending test message…';

      try {
        const result = await api(`/api/guild/${currentGuild}/testing/send`, {
          method: 'POST',
          body: JSON.stringify({ type, channelId, message })
        });
        status.textContent = `✅ ${result.message}`;
        toast('Test message sent.');
      } catch(e) {
        status.textContent = `❌ ${e.message}`;
        toast(e.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function renderPage(page){if(typeof nxDiscardCheck==='function'&&!nxDiscardCheck())return;activePage=page;if(page!=='overview')content.classList.remove('ov-layout-split-preview');nxRenderSideServer();(guildSelect.closest('.nx-select-wrap')||guildSelect).style.display=page==='bot-status'?'none':'';navButtons.forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#page-title').innerHTML=`${pageInfo[page][0]}<span>.</span>`;$('#page-desc').textContent=pageInfo[page][1];if(page==='my-rank'){await renderMyRank();return;}if(page==='overview'){try{await renderOverview()}catch(e){content.innerHTML=`<div class="panel card empty"><h3>Could not load the dashboard</h3><p>${escapeHtml(e&&e.message?e.message:'An unexpected error occurred.')}</p><button type="button" class="btn primary" onclick="location.reload()">Reload dashboard</button></div>`;}return}if(page==='servers'){renderServers();return}if(!me){content.innerHTML=`<div class="panel card empty"><div class="empty-icon">⌁</div><h3>Connect your Discord account</h3><p>Sign in to access your servers and manage ZERON settings.</p><button class="btn primary" data-action="connect-discord">Connect Discord →</button></div>`;return}if(!currentGuild&&page!=='bot-status'){noGuild();return}
if(page==='events'){await renderEvents();return}
try{await loadGuildData()}catch(e){content.innerHTML=`<div class="panel card empty"><h3>Could not load server</h3><p>${escapeHtml(e.message)}</p></div>`;return}
if(page==='channels')content.innerHTML=panel('Channel routing','Pick channels for each bot module. A private channel remains private only when its Discord permission overwrites are configured correctly.',`<div class="form-grid">${channelField('Welcome channel','welcome_channel_id')}${channelField('Moderation log channel','mod_log_channel_id')}${channelField('Bot log channel','bot_log_channel_id')}${channelField('Announcement channel','announcement_channel_id')}${channelField('XP / level-up channel','xp_channel_id')}${channelField('Personal / private channel','personal_channel_id')}</div><div class="muted" style="font-size:11px;margin:0 0 18px">Only text and announcement channels from this server are listed. ZERON does not automatically change channel privacy.</div>`);
else if(page==='welcome')content.innerHTML=panel('Welcome experience','Use {user}, {username}, and {server} placeholders. The message is sent when a new member joins.',`${toggle('Enable welcome messages','Send a welcome when a member joins.','welcome_enabled',settings.welcome_enabled)}<div style="margin-top:18px">${channelField('Destination channel','welcome_channel_id')}<div class="field"><label for="welcome_message">Welcome message</label><textarea id="welcome_message" name="welcome_message">${escapeHtml(settings.welcome_message)}</textarea><small class="muted">Write --- on its own line to add a divider.</small></div></div>`);
else if(page==='leveling')content.innerHTML=panel('XP & leveling','XP is persisted in SQLite. Eligible members earn random XP after the cooldown.',`${toggle('Enable XP system','Track eligible member messages.','xp_enabled',settings.xp_enabled)}${toggle('Level-up announcements','Announce when a member gains a level.','levelup_enabled',settings.levelup_enabled)}<div class="form-grid" style="margin-top:18px">${field('Cooldown (seconds)','xp_cooldown',settings.xp_cooldown,'number','min="5" max="3600"')}${field('Minimum XP','xp_min',settings.xp_min,'number','min="1" max="100"')}${field('Maximum XP','xp_max',settings.xp_max,'number','min="1" max="100"')}${channelField('Level-up channel (blank = current channel)','xp_channel_id')}${multiChannelField('XP-earning channels','xp_channel_ids',settings.xp_channel_ids)}</div><div class="field"><label for="levelup_message">Custom Level-Up Message</label><textarea id="levelup_message" name="levelup_message" maxlength="1800">${escapeHtml(settings.levelup_message || '🎉 Congratulations {user}! You reached level {level} in {server}!')}</textarea><small>Placeholders: {user}, {username}, {server}, {level}, {reward} (role given at this level). Write --- on its own line to add a divider.</small></div><p>Formula: level = floor(√(total XP / 100)). Use /rank and /leaderboard in Discord.</p>`);
else if(page==='rewards'){await renderRewards()}
else if(page==='commands'){await renderCustomCommands()}
else if(page==='automod'){await renderAutomod()}
else if(page==='giveaways'){await renderGiveaways()}
else if(page==='birthdays'){await renderBirthdays()}
else if(page==='tickets'){await renderTickets()}
else if(page==='bot-status'){await renderBotStatus()}
else if(page==='reaction-roles'){await renderReactionRoles()}
else if(page==='announcements'){await renderAnnouncements()}
else if(page==='stats'){await renderStatsChannels()}
else if(page==='onboarding'){await renderOnboarding()}
else if(page==='verification'){await renderVerification()}
else if(page==='embed-builder'){await renderEmbedBuilder()}
else if(page==='jail'){await renderJail()}
else if(page==='autorole'){await renderAutoRole()}
else if(page==='settings')content.innerHTML=panel('General settings','These settings are scoped to the selected server.',`<div class="set-group"><div class="set-title">MODULES</div>${moduleToggles(settings)}</div><div class="set-group"><div class="set-title">APPEARANCE</div><div class="field"><label>Color apply</label><select name="rank_accent">${TK_COLORS.map(([n,v])=>`<option value="${v}" ${v===(settings.rank_accent||'#46BBFF')?'selected':''}>${n}</option>`).join('')}</select></div></div><div class="set-group"><div class="set-title">COMMANDS</div>${field('Command prefix (for custom commands)','prefix',settings.prefix)}</div><div class="set-group"><div class="set-title">MODERATION</div>${toggle('Spam detection','Delete detected spam messages and warn the sender. Requires Manage Messages permission for deletion.','spam_enabled',settings.spam_enabled)}${toggle('Strike system','Count spam strikes and apply a 10-minute timeout after 3 strikes. OFF keeps spam deletion and warnings enabled.','strike_enabled',settings.strike_enabled)}</div><div class="set-group"><div class="set-title">SERVER INFO</div><div class="toggle-row"><div><b>Bot status</b><small>Live Discord gateway connection.</small></div><span class="pill">${$('#bot-status').textContent}</span></div><div class="toggle-row"><div><b>Guild ID</b><small>${currentGuild}</small></div><button class="btn" id="copy-guild">Copy ID</button></div></div>`);
else if(page==='analytics'){await renderAnalytics()}else if(page==='roles'){const d=await api(`/api/guild/${currentGuild}/roles`);content.innerHTML=panel('Role hierarchy & permissions','Review roles in descending position. Role edits are deliberately not exposed as arbitrary dashboard actions.',`<div class="muted" style="font-size:12px;margin-bottom:12px">${escapeHtml(d.note)}</div><div>${d.roles.map(r=>`<div class="role-row"><span>${escapeHtml(r.name)} ${r.managed?'<span class="pill">MANAGED</span>':''}</span><span class="muted">Position ${r.position}</span></div>`).join('')}</div>`,false)}
else if(page==='logs'){
content.innerHTML=panel('Moderation Audit Center','Search and filter recent moderation activity stored for the selected server.',`
<div class="logs-toolbar">
  <div class="field"><label for="logs-search">SEARCH LOGS</label><input id="logs-search" type="search" placeholder="Action, user ID, moderator or reason..."></div>
  <div class="field"><label for="logs-action-filter">FILTER BY ACTION</label><select id="logs-action-filter"><option value="">All actions</option></select></div>
  <button class="btn" id="logs-refresh" type="button">↻ Refresh logs</button>
</div>
<div id="logs-results"><div class="muted">Loading moderation logs...</div></div>
<div class="muted" style="font-size:11px;margin-top:12px">Showing up to 100 latest records. Search and filters apply to the loaded records.</div>`,false);
await loadModerationLogs();
}


saveButton();
const welcomeTestBtn = $('#test-welcome-btn');
if (welcomeTestBtn) welcomeTestBtn.addEventListener('click', async () => {
  const channelId = document.querySelector('[name="welcome_channel_id"]')?.value || '';
  const message = document.querySelector('[name="welcome_message"]')?.value || '';
  if (!currentGuild) return alert('Please select a server first.');
  if (!channelId) return alert('Please select a Welcome channel first.');
  welcomeTestBtn.disabled = true;
  welcomeTestBtn.textContent = 'Sending test...';
  try {
    const response = await fetch('/api/guild/' + encodeURIComponent(currentGuild) + '/testing/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'welcome', channelId, message })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Test failed.');
    alert('Test Welcome message sent!');
  } catch (error) {
    alert(error.message || 'Could not send the test message.');
  } finally {
    welcomeTestBtn.disabled = false;
    welcomeTestBtn.textContent = 'Test Welcome';
  }
});
const levelTestBtn = $('#test-levelup-btn');
if (levelTestBtn) levelTestBtn.addEventListener('click', async () => {
  const channelField = document.querySelector('[name="xp_channel_id"]');
  const channelId = channelField?.value || '';
  if (!currentGuild) {
    alert('Please select a server first.');
    return;
  }
  if (!channelId) {
    alert('Please select a Level-up channel first, then try the test.');
    return;
  }
  levelTestBtn.disabled = true;
  levelTestBtn.textContent = 'Sending test...';
  try {
    const response = await fetch('/api/guild/' + encodeURIComponent(currentGuild) + '/testing/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'levelup', channelId, message: document.querySelector('[name="levelup_message"]')?.value || '' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Test failed.');
    alert('Test Level-Up message sent!');
  } catch (error) {
    alert(error.message || 'Could not send the test message.');
  } finally {
    levelTestBtn.disabled = false;
    levelTestBtn.textContent = 'Test Level-Up';
  }
});
const copy=$('#copy-guild');if(copy)copy.onclick=()=>navigator.clipboard?.writeText(currentGuild).then(()=>toast('Server ID copied.'));
}

async function loadModerationLogs(){
  const results=$('#logs-results');
  const search=$('#logs-search');
  const filter=$('#logs-action-filter');
  const refresh=$('#logs-refresh');
  if(!results||!search||!filter||!refresh)return;

  refresh.onclick=()=>loadModerationLogs();
  refresh.disabled=true;
  refresh.textContent='Loading...';
  results.innerHTML='<div class="muted">Loading moderation logs...</div>';

  try{
    const d=await api(`/api/guild/${currentGuild}/logs`);
    const logs=Array.isArray(d.logs)?d.logs:[];
    const previous=filter.value;
    const actions=[...new Set(logs.map(l=>String(l.action||'Unknown')))].sort();
    filter.innerHTML='<option value="">All actions</option>'+actions.map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    filter.value=actions.includes(previous)?previous:'';

    function render(){
      const q=search.value.trim().toLowerCase();
      const action=filter.value;
      const visible=logs.filter(l=>{
        const matchesAction=!action||String(l.action||'Unknown')===action;
        const haystack=[l.action,l.target_id,l.moderator_id,l.reason,l.created_at]
          .map(v=>String(v||'')).join(' ').toLowerCase();
        return matchesAction&&(!q||haystack.includes(q));
      });

      if(!logs.length){
        results.innerHTML='<div class="empty"><h3>No moderation logs yet</h3><p>Actions recorded by ZERON will appear here.</p></div>';
        return;
      }
      if(!visible.length){
        results.innerHTML='<div class="empty"><h3>No matching logs</h3><p>Try another search term or action filter.</p></div>';
        return;
      }

      results.innerHTML=`<div class="muted" style="font-size:11px;margin-bottom:10px">Showing ${visible.length} of ${logs.length} loaded records</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>ACTION</th><th>TARGET ID</th><th>MODERATOR ID</th><th>REASON</th><th>TIME</th></tr></thead><tbody>
      ${visible.map(l=>`<tr><td><span class="pill">${escapeHtml(l.action||'Unknown')}</span></td><td>${escapeHtml(l.target_id||'—')}</td><td>${escapeHtml(l.moderator_id||'System')}</td><td class="logs-reason">${escapeHtml(l.reason||'—')}</td><td>${escapeHtml(l.created_at||'—')}</td></tr>`).join('')}
      </tbody></table></div>`;
    }

    search.oninput=render;
    filter.onchange=render;
    render();
  }catch(e){
    results.innerHTML=`<div class="empty"><h3>Could not load logs</h3><p>${escapeHtml(e.message||'Please try again.')}</p></div>`;
  }finally{
    refresh.disabled=false;
    refresh.textContent='↻ Refresh logs';
  }
}

async function renderAnalytics(){
  try {
    const d = await api('/api/guild/' + currentGuild + '/analytics');
    const num = v => Number(v || 0).toLocaleString();
    const f = d.features || {};
    const featureCards = '' +
      '<div class="an-tile"><span>WELCOME SYSTEM</span><strong>' + (f.welcomeOn ? 'ON' : 'OFF') + '</strong><small>Welcome messages</small></div>' +
      '<div class="an-tile"><span>XP SYSTEM</span><strong>' + (f.xpOn ? 'ON' : 'OFF') + '</strong><small>Member message XP</small></div>' +
      '<div class="an-tile"><span>LEVEL-UP ANNOUNCEMENTS</span><strong>' + (f.levelupOn ? 'ON' : 'OFF') + '</strong><small>Level notifications</small></div>' +
      '<div class="an-tile"><span>OPEN TICKETS</span><strong>' + num(f.openTickets) + '</strong><small>Tickets open right now</small></div>' +
      '<div class="an-tile"><span>TICKET TYPES</span><strong>' + num(f.ticketTypes) + '</strong><small>Types on your panels</small></div>' +
      '<div class="an-tile"><span>REACTION ROLES</span><strong>' + num(f.reactionRoles) + '</strong><small>Emoji role mappings</small></div>' +
      '<div class="an-tile"><span>AUTO-ROLE</span><strong>' + (f.autoRoleEnabled ? 'ON' : 'OFF') + '</strong><small>' + num(f.autoRolesCount) + ' role(s) on join</small></div>' +
      '<div class="an-tile"><span>LEVEL REWARDS</span><strong>' + num(f.levelRewards) + '</strong><small>Roles tied to levels</small></div>' +
      '<div class="an-tile"><span>MODULES ON</span><strong>' + num(f.modulesOn) + '/' + num(f.modulesTotal) + '</strong><small>Feature switches enabled</small></div>' +
      '';
    const stats =
      '<div class="an-grid">' +
      '<div class="an-tile"><span>XP MEMBERS</span><strong>' + num(d.xp.members) + '</strong><small>Members tracked</small></div>' +
      '<div class="an-tile"><span>TOTAL XP</span><strong>' + num(d.xp.totalXp) + '</strong><small>Accumulated XP</small></div>' +
      '<div class="an-tile"><span>ECONOMY USERS</span><strong>' + num(d.economy.users) + '</strong><small>Users with economy records</small></div>' +
      '<div class="an-tile"><span>TOTAL COINS</span><strong>' + num(d.economy.totalCoins) + '</strong><small>Combined coin balance</small></div>' +
      '<div class="an-tile"><span>TRANSACTIONS</span><strong>' + num(d.transactions.total) + '</strong><small>Recorded transactions</small></div>' +
      '<div class="an-tile"><span>MODERATION</span><strong>' + num(d.moderation.total) + '</strong><small>Recorded actions</small></div>' +
      '<div class="an-tile"><span>HIGHEST LEVEL</span><strong>' + num(d.xp.highestLevel) + '</strong><small>Highest recorded level</small></div>' +
      '<div class="an-tile"><span>TICKET LOG</span><strong>' + (f.ticketLogOn ? 'ON' : 'OFF') + '</strong><small>Transcripts saved on close</small></div>' +
      '<div class="an-tile"><span>TICKET CATEGORY</span><strong>' + (f.ticketCategoryOn ? 'SET' : 'NOT SET') + '</strong><small>Where ticket channels go</small></div>' +
      featureCards + '</div>';

    const xpRows = d.topXp.length
      ? d.topXp.map((u, i) => '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(u.user_id) + '</td><td>' + num(u.level) + '</td><td>' + num(u.xp) + '</td></tr>').join('')
      : '<tr><td colspan="4">No XP records yet.</td></tr>';

    const modRows = d.recentModeration.length
      ? d.recentModeration.map(m => '<tr><td>' + escapeHtml(m.action || '—') + '</td><td>' + escapeHtml(m.target_id || '—') + '</td><td>' + escapeHtml(m.moderator_id || 'System') + '</td><td>' + escapeHtml(m.created_at || '—') + '</td></tr>').join('')
      : '<tr><td colspan="4">No moderation actions recorded.</td></tr>';

    const txRows = d.recentTransactions.length
      ? d.recentTransactions.map(t => '<tr><td>' + escapeHtml(t.user_id || '—') + '</td><td>' + num(t.amount) + '</td><td>' + escapeHtml(t.reason || '—') + '</td><td>' + escapeHtml(t.created_at || '—') + '</td></tr>').join('')
      : '<tr><td colspan="4">No economy transactions recorded.</td></tr>';

    const table = (title, headers, rows) =>
      '<div class="panel card"><h3>' + title + '</h3><div class="table-wrap"><table class="table"><thead><tr>' +
      headers.map(h => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    content.innerHTML = '<div class="section-head"><div><h3>Server analytics</h3><p>Live aggregate data from ZERON SQLite records.</p></div><button class="btn" id="analytics-refresh">Refresh ↻</button></div>' +
      stats +
      table('Top XP members', ['#', 'USER ID', 'LEVEL', 'XP'], xpRows) +
      table('Recent moderation', ['ACTION', 'TARGET', 'MODERATOR', 'TIME'], modRows) +
      table('Recent economy transactions', ['USER ID', 'AMOUNT', 'REASON', 'TIME'], txRows);

    const refresh = document.getElementById('analytics-refresh');
    if (refresh) refresh.onclick = () => renderAnalytics();
  } catch (e) {
    content.innerHTML = '<div class="panel card"><h3>Analytics unavailable</h3><p>' +
      escapeHtml(e.message || 'Could not load analytics.') +
      '</p><button class="btn" id="analytics-retry">Try again ↻</button></div>';
    const retry = document.getElementById('analytics-retry');
    if (retry) retry.onclick = () => renderAnalytics();
  }
}

function previewWelcome(text=settings?.welcome_message){return escapeHtml((text||'Welcome {user} to {server}!').replaceAll('{user}','@ExampleMember').replaceAll('{username}','ExampleMember').replaceAll('{server}',guilds.find(g=>g.id===currentGuild)?.name||'Your Server'))}
async function renderOverview(){
if(!me){
content.innerHTML=`<div class="hero card"><div><div class="eyebrow">ZERON / ADMINISTRATION SUITE</div><h2>Command your community<br><span>with confidence.</span></h2><p>Something exciting is on its way. Sign in with Discord and discover what's waiting for your server.</p><button class="btn primary" data-action="connect-discord">Connect your Discord →</button></div><div class="hero-art"><div class="ring ring1"></div><div class="ring ring2"></div><div class="hero-glyph"><img src="/images/zeron-logo.png" alt="ZERON logo"></div><div class="float-chip chip-a">● SYSTEM READY</div><div class="float-chip chip-b">✦ SECURE ACCESS</div></div></div><div class="an-grid"><div class="an-tile"><span>BOT STATUS</span><strong id="stat-bot">Online</strong><small>Gateway connection</small></div><div class="an-tile"><span>INSTALLED IN</span><strong id="stat-guilds">—</strong><small>Servers Zeron is in</small></div></div>`;
nxFillPublicStats();
return;
}

  const selected=guilds.find(g=>g.id===currentGuild);
  if(!currentGuild){
    content.innerHTML=`<div class="panel card empty"><h3>Pick a server to get started</h3><p>Choose a server to see its systems.</p><button class="btn primary" data-page="servers">Open server selection →</button></div>`;
    content.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>renderPage(b.dataset.page));
    return;
  }
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading your systems…</p></div>';

  let f={};
  try{
    const a=await api(`/api/guild/${currentGuild}/analytics`);
    f=a.features||{};
  }catch(e){}

  const on=v=>Number(v)===1;
  const count=v=>Number(v)||0;
  const system=(page,icon,name,desc,status,state)=>({page,icon,name,desc,status,state});
  const systems=[
    system('welcome',zeronIcon('welcome'),'Welcome system','Greet new members with a message and banner.', on(settings?.welcome_enabled)?'ON':'OFF', on(settings?.welcome_enabled)),
    system('leveling',zeronIcon('xp'),'XP & leveling','Member XP, rank card and level-up messages.', on(settings?.xp_enabled)?'ON':'OFF', on(settings?.xp_enabled)),
    system('rewards',zeronIcon('rewards'),'Level rewards','Roles given when members reach a level.', count(f.levelRewards)+' set', count(f.levelRewards)>0),
    system('autorole',zeronIcon('autorole'),'Auto-role','Roles given to every new member on join.', on(settings?.autorole_enabled)?'ON':'OFF', on(settings?.autorole_enabled)),
    system('reaction-roles',zeronIcon('reaction'),'Reaction roles','Roles from emoji reactions on messages.', count(f.reactionRoles)+' mapped', count(f.reactionRoles)>0),
    system('tickets',zeronIcon('tickets'),'Tickets','Private support channels with transcripts.', count(f.ticketTypes)+' type(s)', count(f.ticketTypes)>0),
    system('commands',zeronIcon('commands'),'Custom commands','Text and embed replies for your members.', 'Manage', null),
    system('birthdays',zeronIcon('birthdays'),'Birthdays','Birthday wishes posted automatically.', 'Manage', null),
    system('channels',zeronIcon('channels'),'Channel manager','Pick where logs and announcements go.', 'Manage', null)
  ];

  const cards=systems.map(x=>`<button class="sys-card card" data-page="${x.page}"><div class="sys-top"><span class="sys-icon">${x.icon}</span><span class="sys-pill ${x.state===true?'on':''}">${escapeHtml(x.status)}</span></div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.desc)}</small><span class="sys-open">Open →</span></button>`).join('');

  const st=await api(`/api/guild/${currentGuild}/overview-stats`).catch(()=>null);
  content.classList.add('ov-layout-split-preview');
  content.innerHTML=`${ovHealthHtml(st)}
  <div class="section-head"><div><h3>Systems</h3><p>Tap a system to configure it.</p></div></div>
  <div class="sys-grid">${cards}</div>`;
  content.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>renderPage(b.dataset.page));
  loadOverviewFeed();
}

function ovHealthHtml(st){
  if(!st) return '<div class="panel card"><p class="rw-sub">Overview is unavailable right now.</p></div>';
  const trend=Array.isArray(st.trend)?st.trend:[];
  const net=(Number(st.joined7d)||0)-(Number(st.left7d)||0);
  const top=Math.max(1,...trend.map(d=>d.messages||0));
  const bars=trend.map(d=>{
    const h=Math.max(6,Math.round((d.messages||0)/top*100));
    return `<div class="ov-bar-col" title="${escapeHtml(d.label)}: ${d.messages||0} messages, ${d.joins||0} joins, ${d.leaves||0} leaves"><span class="ov-bar-count">${d.messages||0}</span><div class="ov-bar" style="height:${h}%"></div><span class="ov-bar-label">${escapeHtml(d.label)}</span></div>`;
  }).join('');
  return `
  <div class="ov-health card">
    <div class="ov-health-head">
      <div><div class="eyebrow">SERVER HEALTH</div><h2>${(Number(st.members)||0).toLocaleString('en-US')} members</h2></div>
      <span class="sys-pill on">Live</span>
    </div>
    <div class="ov-kpis">
      <div class="ov-kpi"><span>Online now</span><strong>${st.online==null?'—':Number(st.online).toLocaleString('en-US')}</strong></div>
      <div class="ov-kpi"><span>Messages (24h)</span><strong>${Number(st.messages24)||0}</strong></div>
      <div class="ov-kpi"><span>New joins (7d)</span><strong>${Number(st.joined7d)||0}</strong></div>
      <div class="ov-kpi"><span>Net change (7d)</span><strong class="${net>=0?'pos':'neg'}">${net>=0?'+':''}${net}</strong></div>
    </div>
    <div class="ov-chart-head"><h3>Messages, last 7 days</h3></div>
    <div class="ov-chart">${bars}</div>
  </div>
  <div class="ov-quick-section">
  <div class="section-head"><div><h3>Quick actions</h3><p>Jump straight to the tool you need.</p></div></div>
  <div class="ov-quick">
    <button class="btn primary ov-action" data-page="giveaways"><span class="ov-act-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M5 12v9h14v-9"/><path d="M7.5 8a2.5 2.5 0 1 1 4.5-3c0 1.5-4.5 3-4.5 3z"/><path d="M16.5 8a2.5 2.5 0 1 0-4.5-3c0 1.5 4.5 3 4.5 3z"/></svg></span><span>New giveaway</span></button>
    <button class="btn ov-action" data-page="verification"><span class="ov-act-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg></span><span>Verification</span></button>
    <button class="btn ov-action" data-page="tickets"><span class="ov-act-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 0 0-4V4H3z"/><path d="M14 4v16"/></svg></span><span>Tickets</span></button>
    <button class="btn ov-action" data-page="announcements"><span class="ov-act-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10v4h4l8 4V6L7 10z"/><path d="M19 9a4 4 0 0 1 0 6"/></svg></span><span>Announce</span></button>
  </div>
  </div>
  <div class="ov-feed-section">
  <div class="section-head"><div><h3>Recent activity</h3><p>Latest moderation actions in this server.</p></div></div>
  <div class="ov-feed card" id="ov-feed"><p class="rw-sub">Loading…</p></div>
  </div>`;
}

function renderServers(){
  if(!me){content.innerHTML=`<div class="panel card empty"><div class="empty-icon">⌁</div><h3>Sign in to select a server</h3><p>Discord will show servers where you have Manage Server or Administrator permission.</p><button class="btn primary" data-action="connect-discord">Connect Discord →</button></div>`;return}
  const view=window.nxServerView||(window.nxServerView={tab:'all',q:''});
  const installed=guilds.filter(g=>g.installed);
  const notAdded=guilds.filter(g=>!g.installed);
  const tabs=[['all','All',guilds.length],['active','Active',installed.length],['notadded','Not added',notAdded.length]];
  const q=view.q.trim().toLowerCase();
  const match=g=>(g.name||'').toLowerCase().includes(q);
  const shownInstalled=view.tab==='notadded'?[]:installed.filter(match);
  const shownNotAdded=view.tab==='active'?[]:notAdded.filter(match);
  const tabHtml=tabs.map(([v,l,n])=>`<button type="button" class="srv-tab ${view.tab===v?'on':''}" data-srv-tab="${v}">${l} <span>${n}</span></button>`).join('');
  const card=g=>`<div class="srv-card ${g.installed?'is-active':''}"><div class="srv-icon">${nxServerIcon(g)?`<img src="${nxServerIcon(g)}" alt="">`:escapeHtml((g.name||'?').trim().charAt(0).toUpperCase())}</div><div class="srv-info"><strong>${escapeHtml(g.name)}</strong><span class="srv-status ${g.installed?'on':''}">${g.installed?'● Active':'Not added'}</span></div>${g.installed?`<button type="button" class="btn primary srv-manage" data-guild="${g.id}">Manage</button>`:`<a class="btn primary srv-manage" href="${zeronInviteUrl(g.id)}" target="_blank" rel="noopener">Add bot</a>`}</div>`;
  const section=(title,items)=>items.length?`<div class="srv-section">${title} <span>${items.length}</span></div>${items.map(card).join('')}`:'';
  const body=section('Ready to manage',shownInstalled)+section('Available to add',shownNotAdded);
  content.innerHTML=`<div class="panel card srv-panel">
    <div class="eyebrow">YOUR SERVERS</div>
    <h3 class="srv-title">Welcome back, ${escapeHtml(me.global_name||me.username||'there')}.</h3>
    <p class="rw-sub">Open a server ZERON is already in, or add it to a new one. You only see servers where you have Manage Server or Administrator.</p>
    <div class="srv-tabs">${tabHtml}</div>
    <input id="srv-search" class="rr-input srv-search" placeholder="Search servers…" value="${escapeHtml(view.q)}">
    <div class="srv-grid">${body||'<div class="rw-empty"><b>No servers here</b><span>Try another tab or search.</span></div>'}</div>
  </div>`;
  content.querySelectorAll('[data-srv-tab]').forEach(b=>b.onclick=()=>{view.tab=b.dataset.srvTab;renderServers();});
  const search=document.getElementById('srv-search');
  search.oninput=()=>{
    view.q=search.value;
    const pos=search.selectionStart;
    renderServers();
    const again=document.getElementById('srv-search');
    again.focus();
    again.setSelectionRange(pos,pos);
  };
  content.querySelectorAll('[data-guild]').forEach(b=>b.onclick=()=>{
    currentGuild=b.dataset.guild;
    guildSelect.value=currentGuild;
    refreshCustomSelect(guildSelect);
    renderPage('overview');
  });
}
/* ZERON CUSTOM DROPDOWN ENGINE V1 */
function refreshCustomSelect(select) {
  if (!select || !select._nxDropdown) return;

  const { button, menu } = select._nxDropdown;
  const selected = select.options[select.selectedIndex];

  button.textContent = selected ? selected.textContent.trim() : 'Choose an option';
  button.disabled = select.disabled;
  button.setAttribute('aria-expanded', String(menu.classList.contains('open')));

  const signature = Array.from(select.options).map(o => o.textContent.trim() + (o.disabled ? '!' : '')).join('|') + '#' + select.selectedIndex;
  if (menu._nxSignature === signature) return;
  menu._nxSignature = signature;

  menu.replaceChildren();

  Array.from(select.options).forEach((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'nx-dropdown-option';
    item.textContent = option.textContent.trim();
    item.disabled = option.disabled;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === select.selectedIndex));

    if (index === select.selectedIndex) item.classList.add('selected');

    item.addEventListener('click', () => {
      if (option.disabled) return;

      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      refreshCustomSelect(select);
      menu.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    });

    menu.appendChild(item);
  });
}

function enhanceCustomSelect(select) {
  if (!select || select._nxDropdown) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'nx-select-wrap';

  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  select.classList.add('nx-native-select');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nx-dropdown-trigger';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const arrow = document.createElement('span');
  arrow.className = 'nx-dropdown-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '⌄';
  button.appendChild(arrow);

  const menu = document.createElement('div');
  menu.className = 'nx-dropdown-menu';
  menu.setAttribute('role', 'listbox');

  button.addEventListener('click', () => {
    const shouldOpen = !menu.classList.contains('open');

    document.querySelectorAll('.nx-dropdown-menu.open').forEach(openMenu => {
      openMenu.classList.remove('open');
      const owner = openMenu.closest('.nx-select-wrap');
      owner?.querySelector('.nx-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
    });

    if (shouldOpen) {
      refreshCustomSelect(select);
      menu.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
    }
  });

  wrapper.append(button, menu);

  select._nxDropdown = { wrapper, button, menu };

  select.addEventListener('change', () => refreshCustomSelect(select));

  const optionObserver = new MutationObserver(() => refreshCustomSelect(select));
  optionObserver.observe(select, {
    childList: true,
    subtree: true,
    characterData: true
  });

  refreshCustomSelect(select);
}

function installCustomDropdowns(root = document) {
  root.querySelectorAll('select').forEach(enhanceCustomSelect);
}

document.addEventListener('click', event => {
  if (event.target.closest('.nx-select-wrap')) return;

  document.querySelectorAll('.nx-dropdown-menu.open').forEach(menu => {
    menu.classList.remove('open');
    menu.closest('.nx-select-wrap')
      ?.querySelector('.nx-dropdown-trigger')
      ?.setAttribute('aria-expanded', 'false');
  });
});

const nxDropdownObserver = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.('select')) enhanceCustomSelect(node);
      installCustomDropdowns(node);
    }
  }
});

installCustomDropdowns();
nxDropdownObserver.observe(document.body, { childList: true, subtree: true });

/* ZERON PREMIUM: MULTI-SELECT + LEVEL REWARDS */
function closeOpenDropdowns(except=null){
  document.querySelectorAll('.nx-dropdown-menu.open').forEach(menu=>{
    if(menu===except)return;
    menu.classList.remove('open');
    menu.closest('.nx-select-wrap')?.querySelector('.nx-dropdown-trigger')?.setAttribute('aria-expanded','false');
  });
}
document.addEventListener('click',event=>{
  const trigger=event.target.closest('.nx-multi-trigger');
  if(!trigger)return;
  const menu=trigger.parentElement.querySelector('.nx-multi-menu');
  const willOpen=!menu.classList.contains('open');
  closeOpenDropdowns(menu);
  menu.classList.toggle('open',willOpen);
  trigger.setAttribute('aria-expanded',String(willOpen));
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(!input.matches||!input.matches('.nx-multi-menu input[type="checkbox"]'))return;
  const wrap=input.closest('.nx-multi');
  const ids=Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(box=>box.value);
  wrap.querySelector('.nx-multi-label').innerHTML=multiSummary(ids);
});

let rwState=null;

function rwRoleById(id){return rwState.roles.find(r=>r.id===id)||null}
function rwColor(hex){return hex&&hex!=='#000000'?hex:'#9690ad'}

function rwRoleOptions(selectedId){
  const placeholder='<option value="">— Choose a role —</option>';
  const known=rwState.roles.map(r=>`<option value="${r.id}" ${r.id===selectedId?'selected':''} ${r.assignable?'':'disabled'}>@ ${escapeHtml(r.name)}${r.assignable?'':' (ZERON cannot assign)'}</option>`).join('');
  const missing=selectedId&&!rwRoleById(selectedId)?`<option value="${escapeHtml(selectedId)}" selected>Unavailable role (choose another)</option>`:'';
  return placeholder+known+missing;
}

// Copies what is typed in edit mode back into state before any redraw.
function rwSyncFromDom(){
  if(!rwState||!rwState.editing)return;
  rwState.rows=Array.from(document.querySelectorAll('#rw-root [data-rw-row]')).map(row=>({
    level:row.querySelector('.rw-level-input').value,
    role_id:row.querySelector('.rw-role-select').value
  }));
}

function rwRowsHtml(grid){
  if(!rwState.rows.length){
    return '<div class="rw-empty"><div class="rw-empty-icon">❖</div><b>No level rewards yet</b><span>Press Edit to add your first reward.</span></div>';
  }
  return rwState.rows.map((row,i)=>{
    if(rwState.editing){
      return `<div class="rw-row ${grid}" data-rw-row><input type="number" min="1" max="99" maxlength="2" class="rw-level-input" data-truncate="2" value="${escapeHtml(String(row.level))}" aria-label="Level"><div class="rw-select-slot"><select class="rw-role-select" aria-label="Role">${rwRoleOptions(row.role_id)}</select></div><button type="button" class="rw-remove" data-rw-remove="${i}">Remove</button></div>`;
    }
    const role=rwRoleById(row.role_id);
    const chip=role
      ?`<span class="rw-role-chip"><i style="background:${rwColor(role.color)}"></i>@ ${escapeHtml(role.name)}${role.assignable?'':'<em>ZERON cannot assign</em>'}</span>`
      :'<span class="rw-role-chip rw-role-missing">Unavailable role</span>';
    return `<div class="rw-row ${grid}"><span class="rw-level-badge">LVL ${escapeHtml(String(row.level))}</span>${chip}</div>`;
  }).join('');
}

function rwDraw(){
  const root=document.getElementById('rw-root');
  if(!root||!rwState)return;
  const editing=rwState.editing;
  const grid=editing?'rw-grid-edit':'rw-grid-view';
  const count=rwState.rows.length;
  const warning=rwState.botCanManageRoles?'':'<div class="rw-warning">⚠ ZERON does not have Manage Roles in this server. Grant it in Discord before rewards can be given.</div>';
  const head=count?`<div class="rw-head ${grid}"><span>Level</span><span>Role</span>${editing?'<span></span>':''}</div>`:'';
  const actions=editing
    ?'<button type="button" class="btn" id="rw-add">+ Add more</button><span class="rw-spacer"></span><button type="button" class="btn" id="rw-cancel">Cancel</button><button type="button" class="btn primary" id="rw-save">Save →</button>'
    :'<button type="button" class="btn primary" id="rw-edit">✎ Edit rewards</button>';
  root.innerHTML=`<div class="panel card rw-card">
    <div class="rw-top"><div><div class="eyebrow">AUTOMATION · LEVEL REWARDS</div><h3 class="rw-title">Level rewards</h3><p class="rw-sub">Roles are given automatically when members level up. Rewards stack.</p></div><div class="rw-count"><b>${count}</b><span>${count===1?'reward':'rewards'}</span></div></div>
    ${warning}${head}
    <div class="rw-list">${rwRowsHtml(grid)}</div>
    <div class="rw-actions">${actions}</div>
  </div>`;
}

async function rwSave(btn){
  rwSyncFromDom();
  const rewards=rwState.rows.map(r=>({level:Number(r.level),role_id:r.role_id}));
  btn.disabled=true;
  btn.textContent='Saving…';
  try{
    await api(`/api/guild/${currentGuild}/level-rewards`,{method:'PUT',body:JSON.stringify({rewards})});
    toast('Level rewards saved. Members get them on their next level-up.');
    await renderRewards();
  }catch(e){
    toast(e.message,true);
    btn.disabled=false;
    btn.textContent='Save →';
  }
}

function rwOnClick(event){
  const removeBtn=event.target.closest('[data-rw-remove]');
  if(removeBtn){
    rwSyncFromDom();
    rwState.rows.splice(Number(removeBtn.dataset.rwRemove),1);
    rwDraw();
    return;
  }
  const btn=event.target.closest('button');
  if(!btn)return;
  if(btn.id==='rw-edit'){rwState.editing=true;rwDraw();return}
  if(btn.id==='rw-cancel'){rwState.rows=rwState.original.map(r=>({...r}));rwState.editing=false;rwDraw();return}
  if(btn.id==='rw-add'){
    rwSyncFromDom();
    const levels=rwState.rows.map(r=>Number(r.level)).filter(Number.isFinite);
    rwState.rows.push({level:String(Math.min(99,Math.max(0,...levels)+5)||5),role_id:''});
    rwDraw();
    return;
  }
  if(btn.id==='rw-save'){rwSave(btn)}
}

async function renderRewards(){
  content.innerHTML='<div id="rw-root"><div class="panel card rw-card"><p class="rw-sub">Loading level rewards…</p></div></div>';
  try{
    const data=await api(`/api/guild/${currentGuild}/level-rewards`);
    rwState={
      roles:data.roles,
      botCanManageRoles:data.botCanManageRoles,
      editing:false,
      rows:data.rewards.map(r=>({level:r.level,role_id:r.role_id})),
      original:[]
    };
    rwState.original=rwState.rows.map(r=>({...r}));
    document.getElementById('rw-root').addEventListener('click',rwOnClick);
    rwDraw();
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load level rewards</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}


document.addEventListener('click', event => {
  if (event.target.closest('[data-action="connect-discord"]')) {
    location.href = '/auth/discord';
  }
});
document.addEventListener('input', event => {
  const field = event.target.closest('[data-truncate]');
  if (field) field.value = field.value.slice(0, Number(field.dataset.truncate) || 0);
});

async function boot(){try{const h=await api('/health');$('#bot-status').textContent=h.botReady?'Bot online':'Bot offline';$('#stat-bot').textContent=h.botReady?'Online':'Offline'}catch{$('#bot-status').textContent='Status unavailable'}try{const d=await api('/api/me');me=d.user;document.body.classList.toggle('logged-out',!me);if(me){$('#login-btn').hidden=true;$('#login-btn').classList.add('hidden');$('#profile').textContent=`Signed in as ${me.global_name||me.username}`;$('#profile').classList.remove('hidden');await loadGuilds()}else{$('#login-btn').hidden=false;$('#login-btn').classList.remove('hidden')}}catch{me=null;document.body.classList.add('logged-out');$('#login-btn').hidden=false;$('#login-btn').classList.remove('hidden')}renderPage('overview')}
navButtons.forEach(b=>b.addEventListener('click',()=>renderPage(b.dataset.page)));guildSelect.addEventListener('change',()=>{currentGuild=guildSelect.value;if(currentGuild&&!guilds.find(g=>g.id===currentGuild)?.installed){toast('ZERON is not installed in this server.',true);return}renderPage(activePage)});$('#login-btn').onclick=()=>location.href='/auth/discord';const heroLogin=$('#hero-login');if(heroLogin)heroLogin.onclick=()=>location.href='/auth/discord';document.body.addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b&&b.classList.contains('quick'))renderPage(b.dataset.page)});boot();






/* ZERON V7: tap animation, logout button, session-aware header */
(function zeronV7(){
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
      location.href = '/';
    });
  }
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.user) {
        if (loginBtn) loginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
      }
    })
    .catch(function () {});
})();


/* ZERON ROUND 2: auto-role on join (dropdown + current list) */
async function renderAutoRole(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading auto-role…</p></div>';
  try{
    const data=await api(`/api/guild/${currentGuild}/auto-roles`);
    const enabled=Number(settings.autorole_enabled)===1;
    const warning=data.botCanManageRoles?'':'<div class="rw-warning">⚠ ZERON does not have Manage Roles in this server. Grant it in Discord before auto-role can work.</div>';
    const roleById=new Map(data.roles.map(r=>[r.id,r]));
    const available=data.roles.filter(r=>!data.roleIds.includes(r.id));
    const roleOptions='<option value="">— Choose a role —</option>'+available.map(r=>`<option value="${r.id}" ${r.assignable?'':'disabled'}>@ ${escapeHtml(r.name)}${r.assignable?'':' (ZERON cannot assign)'}</option>`).join('');
    const list=data.roleIds.length
      ? data.roleIds.map(id=>{
          const r=roleById.get(id);
          const info=r?'@ '+escapeHtml(r.name)+(r.assignable?'':' · ZERON cannot assign'):'Unavailable role';
          return `<div class="rr-row"><span class="rw-level-badge">ROLE</span><span class="rr-info">${info}</span><button type="button" class="rw-remove" data-ar-remove="${id}">Remove</button></div>`;
        }).join('')
      : '<div class="rw-empty"><div class="rw-empty-icon">⚡</div><b>No auto-roles yet</b><span>Choose a role below to add it.</span></div>';

    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">AUTOMATION · ON JOIN</div><h3 class="rw-title">Auto-role on join</h3><p class="rw-sub">New members get these roles as soon as they join. Up to 10 roles.</p></div></div>
      ${warning}
      <div class="toggle-row"><div><b>Enable auto-role</b><small>Give these roles to every new member.</small></div><input class="switch" type="checkbox" id="ar-enabled" ${enabled?'checked':''}></div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Role to add</label><select id="ar-role">${roleOptions}</select></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="ar-add">Add role →</button></div>
      <div class="set-title sp-section">Current auto-roles</div>
      <div class="rr-list" id="ar-list">${list}</div>
    </div>`;

    const saveRoles=ids=>api(`/api/guild/${currentGuild}/auto-roles`,{method:'PUT',body:JSON.stringify({roleIds:ids})});

    document.getElementById('ar-add').onclick=async()=>{
      const roleId=document.getElementById('ar-role').value;
      if(!roleId){toast('Choose a role first.',true);return}
      if(data.roleIds.length>=10){toast('You can add up to 10 auto-roles.',true);return}
      try{
        await saveRoles([...data.roleIds,roleId]);
        toast('Auto-role added.');
        renderAutoRole();
      }catch(e){
        toast(e.message,true);
      }
    };

    document.getElementById('ar-list').addEventListener('click',async event=>{
      const removeBtn=event.target.closest('[data-ar-remove]');
      if(!removeBtn)return;
      try{
        await saveRoles(data.roleIds.filter(id=>id!==removeBtn.dataset.arRemove));
        toast('Auto-role removed.');
        renderAutoRole();
      }catch(e){
        toast(e.message,true);
      }
    });

    document.getElementById('ar-enabled').onchange=async event=>{
      const on=event.target.checked;
      try{
        await api(`/api/guild/${currentGuild}/settings`,{method:'PUT',body:JSON.stringify({autorole_enabled:on})});
        settings.autorole_enabled=on?1:0;
        toast(on?'Auto-role is ON.':'Auto-role is OFF.');
      }catch(e){
        toast(e.message,true);
        event.target.checked=!on;
      }
    };
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load auto-role</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}

/* ZERON ROUND 3: reaction roles (custom message: text + emoji/role pairs) */
function rrEmojiLabel(key){
  return /^[A-Za-z0-9_]+:\d+$/.test(key) ? ':' + key.split(':')[0] + ':' : key;
}
function rrRoleOptions(roles,selectedId=''){
  return '<option value="">— Choose a role —</option>'+roles.map(r=>`<option value="${r.id}" ${r.id===selectedId?'selected':''} ${r.assignable?'':'disabled'}>@ ${escapeHtml(r.name)}${r.assignable?'':' (ZERON cannot assign)'}</option>`).join('');
}
function rrPairRow(roles,emoji='',roleId=''){
  return `<div class="rr-pair" data-rr-pair><input class="rr-input rr-pair-emoji" maxlength="40" placeholder="Emoji" value="${escapeHtml(emoji)}"><div class="rr-pair-role"><select class="rr-pair-select">${rrRoleOptions(roles,roleId)}</select></div><button type="button" class="rw-remove" data-rr-pair-remove>Remove</button></div>`;
}
async function renderReactionRoles(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading reaction roles…</p></div>';
  try{
    const [data, roleData] = await Promise.all([
      api(`/api/guild/${currentGuild}/reaction-roles`),
      api(`/api/guild/${currentGuild}/auto-roles`)
    ]);
    const channelOptions=channels.map(c=>`<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
    const warning=roleData.botCanManageRoles?'':'<div class="rw-warning">⚠ ZERON does not have Manage Roles in this server. Grant it in Discord before reaction roles can work.</div>';
    const list=data.rows.length
      ? data.rows.map(row=>`<div class="rr-row"><span class="rw-level-badge">${escapeHtml(rrEmojiLabel(row.emoji))}</span><span class="rr-info">@ ${escapeHtml(row.role_name||'Unavailable role')} · message ${escapeHtml(row.message_id)}${row.assignable?'':' · ZERON cannot assign'}</span><button type="button" class="rw-remove" data-rr-remove="${escapeHtml(row.message_id)}|${encodeURIComponent(row.emoji)}">Remove</button></div>`).join('')
      : '<div class="rw-empty"><b>No reaction roles yet</b><span>Create a message below.</span></div>';

    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">AUTOMATION · REACTIONS</div><h3 class="rw-title">Reaction roles</h3><p class="rw-sub">Write the message, add emoji and roles. The bot posts it and adds the reactions for you.</p></div></div>
      ${warning}
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Channel</label><select id="rr-channel"><option value="">— Choose a channel —</option>${channelOptions}</select></div>
        <div class="field"><label>Message text</label><textarea id="rr-content" class="rr-textarea" maxlength="1800" placeholder="Write your message here"></textarea></div>
      </div>
      <div class="set-title sp-section">Emoji and role pairs (up to 10)</div>
      <div id="rr-pairs">${rrPairRow(roleData.roles)}</div>
      <div class="rewards-actions"><button type="button" class="btn" id="rr-add-pair">+ Add emoji role</button></div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="rr-create">Create reaction message →</button></div>
      <div class="set-title sp-section">Current reaction roles</div>
      <div class="rr-list" id="rr-list">${list}</div>
    </div>`;

    document.getElementById('rr-add-pair').onclick=()=>{
      const count=document.querySelectorAll('[data-rr-pair]').length;
      if(count>=10){toast('You can add up to 10 emoji roles.',true);return}
      document.getElementById('rr-pairs').insertAdjacentHTML('beforeend',rrPairRow(roleData.roles));
    };

    document.getElementById('rr-pairs').addEventListener('click',event=>{
      const removeBtn=event.target.closest('[data-rr-pair-remove]');
      if(!removeBtn)return;
      if(document.querySelectorAll('[data-rr-pair]').length<=1){toast('Keep at least one emoji role.',true);return}
      removeBtn.closest('[data-rr-pair]').remove();
    });

    document.getElementById('rr-create').onclick=async()=>{
      const btn=document.getElementById('rr-create');
      const pairs=Array.from(document.querySelectorAll('[data-rr-pair]')).map(row=>({
        emoji:row.querySelector('.rr-pair-emoji').value.trim(),
        roleId:row.querySelector('.rr-pair-select').value
      }));
      btn.disabled=true;
      btn.textContent='Posting…';
      try{
        await api(`/api/guild/${currentGuild}/reaction-roles/message`,{method:'POST',body:JSON.stringify({
          channelId:document.getElementById('rr-channel').value,
          content:document.getElementById('rr-content').value,
          pairs
        })});
        toast('Reaction message posted. Members can now react to get their roles.');
        renderReactionRoles();
      }catch(e){
        toast(e.message,true);
        btn.disabled=false;
        btn.textContent='Create reaction message →';
      }
    };

    document.getElementById('rr-list').addEventListener('click',async event=>{
      const removeBtn=event.target.closest('[data-rr-remove]');
      if(!removeBtn)return;
      const [messageId,encodedEmoji]=removeBtn.dataset.rrRemove.split('|');
      try{
        await api(`/api/guild/${currentGuild}/reaction-roles/${encodeURIComponent(messageId)}/${encodedEmoji}`,{method:'DELETE'});
        toast('Reaction role removed. The message stays in the channel.');
        renderReactionRoles();
      }catch(e){
        toast(e.message,true);
      }
    });
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load reaction roles</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}

/* ZERON: bot status (developer only) */
async function renderBotStatus(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading bot status…</p></div>';
  try{
    const p=await api('/api/developer/presence');
    const opt=(value,label,current)=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`;
    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">DEVELOPER · BOT PROFILE</div><h3 class="rw-title">Bot status</h3><p class="rw-sub">Changes how the bot looks in every server. Only the developer can see this page.</p></div></div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Status text</label><input id="bs-text" class="rr-input" maxlength="128" value="${escapeHtml(p.text)}" placeholder="e.g. Chilling now"></div>
        
        <div class="field"><label>Status</label><select id="bs-status">${opt('online','Online',p.status)}${opt('idle','Idle',p.status)}${opt('dnd','Do Not Disturb',p.status)}${opt('invisible','Invisible',p.status)}</select></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="bs-save">Save bot status →</button></div>
    </div>`;
    document.getElementById('bs-save').onclick=async()=>{
      const btn=document.getElementById('bs-save');
      btn.disabled=true;
      btn.textContent='Saving…';
      try{
        await api('/api/developer/presence',{method:'PUT',body:JSON.stringify({
          text:document.getElementById('bs-text').value,
          status:document.getElementById('bs-status').value
        })});
        toast('Bot status updated.');
        renderBotStatus();
      }catch(e){
        toast(e.message,true);
        btn.disabled=false;
        btn.textContent='Save bot status →';
      }
    };
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Not available</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}
(async function revealDevNav(){
  try{
    await api('/api/developer/presence');
    const nav=document.getElementById('dev-nav');
    if(nav)nav.classList.remove('hidden');
  }catch(e){}
})();


/* ZERON ROUND 4: tickets (advanced: types, categories, multi support roles, transcripts) */
const TK_COLORS=[['Blue (Default)','#46BBFF'],['Deep Blue','#279CF9'],['Ice','#6BE0FF'],['Red','#ef4444'],['Green','#22c55e']];
async function renderTickets(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading tickets…</p></div>';
  try{
    const d=await api(`/api/guild/${currentGuild}/ticket-setup`);
    const roleOpts='<option value="">— Choose a support role —</option>'+d.roles.map(r=>`<option value="${r.id}">@ ${escapeHtml(r.name)}</option>`).join('');
    const colorOpts=(sel)=>TK_COLORS.map(([n,v])=>`<option value="${v}" ${v===sel?'selected':''}>${n}</option>`).join('');
    const catOpts='<option value="">— No category (top of server) —</option>'+d.categories.map(c=>`<option value="${c.id}" ${c.id===d.config.category_id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
    const logOpts='<option value="">— No transcript log —</option>'+d.textChannels.map(c=>`<option value="${c.id}" ${c.id===d.config.log_channel_id?'selected':''}>#${escapeHtml(c.name)}</option>`).join('');
    const chOpts='<option value="">— Choose a channel —</option>'+d.textChannels.map(c=>`<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
    const roleById=new Map(d.roles.map(r=>[r.id,r]));
    const warning=d.botCanManageChannels?'':'<div class="rw-warning">⚠ ZERON does not have Manage Channels in this server. Tickets cannot be created without it.</div>';
    const typeRows=d.types.length?d.types.map(t=>`<div class="rr-row"><span class="rw-level-badge" style="background:${t.color}">${escapeHtml(t.button_label)}</span><span class="rr-info">${escapeHtml(t.name)} · ${t.support_role_ids.length} support role(s)</span><button type="button" class="rw-remove" data-tk-type-del="${t.id}">Delete</button></div>`).join(''):'<div class="rw-empty"><b>No ticket types yet</b><span>Create one below, for example General Support or Report.</span></div>';
    const panelChecks=d.types.map(t=>`<label class="nx-check tk-type-check"><input type="checkbox" class="tk-type-box" value="${t.id}" checked><span>${escapeHtml(t.name)} · ${escapeHtml(t.button_label)}</span></label>`).join('')||'<div class="rw-sub">Create a ticket type first.</div>';

    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">SUPPORT · TICKETS</div><h3 class="rw-title">Tickets</h3><p class="rw-sub">Members open private channels from panel buttons. Each ticket type has its own support roles.</p></div></div>
      ${warning}
      ${tkStats(d)}
      <div class="set-title sp-section">Ticket setup</div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Category for ticket channels</label><select id="tk-category">${catOpts}</select></div>
        <div class="field"><label>Transcript log channel</label><select id="tk-log">${logOpts}</select></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn" id="tk-save-config">Save setup</button></div>

      <div class="set-title sp-section">Ticket types (up to 5)</div>
      <div class="rr-list" id="tk-types">${typeRows}</div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Type name</label><input id="tk-name" class="rr-input" maxlength="40" placeholder="General Support"></div>
        <div class="field"><label>Button label</label><input id="tk-label" class="rr-input" maxlength="40" placeholder="Create support ticket"></div>
        
        <div class="field"><label>Support roles (up to 10)</label><select id="tk-role-add">${roleOpts}</select></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn" id="tk-role-btn">+ Add support role</button></div>
      <div class="rr-list" id="tk-role-list"></div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="tk-create-type">Create ticket type →</button></div>

      <div class="set-title sp-section">Post a ticket panel</div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Channel</label><select id="tk-panel-channel">${chOpts}</select></div>
        <div class="field"><label>Panel title</label><input id="tk-panel-title" class="rr-input" maxlength="100" placeholder="Need help?"></div>
        <div class="field"><label>Panel description</label><textarea id="tk-panel-desc" class="rr-textarea" maxlength="2000" placeholder="Pick the type that fits your issue and click its button."></textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
        
      </div>
      <div class="set-title sp-section">Buttons on this panel</div>
      <div class="tk-panel-types">${panelChecks}</div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="tk-post-panel">Post ticket panel →</button></div>
    </div>`;

    let tkRoles=[];
    const drawRoles=()=>{
      document.getElementById('tk-role-list').innerHTML=tkRoles.length?tkRoles.map(id=>{const r=roleById.get(id);return `<div class="rr-row"><span class="rw-level-badge">ROLE</span><span class="rr-info">@ ${escapeHtml(r?r.name:'Unavailable role')}</span><button type="button" class="rw-remove" data-tk-role-del="${id}">Remove</button></div>`}).join(''):'';
    };

    document.getElementById('tk-save-config').onclick=async()=>{
      try{
        await api(`/api/guild/${currentGuild}/ticket-setup/config`,{method:'PUT',body:JSON.stringify({
          categoryId:document.getElementById('tk-category').value,
          logChannelId:document.getElementById('tk-log').value
        })});
        toast('Ticket setup saved.');
      }catch(e){toast(e.message,true)}
    };

    document.getElementById('tk-role-btn').onclick=()=>{
      const id=document.getElementById('tk-role-add').value;
      if(!id){toast('Choose a support role first.',true);return}
      if(tkRoles.includes(id)){toast('That role is already added.',true);return}
      if(tkRoles.length>=10){toast('You can add up to 10 support roles.',true);return}
      tkRoles.push(id);
      drawRoles();
    };

    document.getElementById('tk-role-list').addEventListener('click',event=>{
      const btn=event.target.closest('[data-tk-role-del]');
      if(!btn)return;
      tkRoles=tkRoles.filter(id=>id!==btn.dataset.tkRoleDel);
      drawRoles();
    });

    document.getElementById('tk-create-type').onclick=async()=>{
      try{
        await api(`/api/guild/${currentGuild}/ticket-setup/types`,{method:'POST',body:JSON.stringify({
          name:document.getElementById('tk-name').value.trim(),
          buttonLabel:document.getElementById('tk-label').value.trim(),
          roleIds:tkRoles
        })});
        toast('Ticket type created.');
        renderTickets();
      }catch(e){toast(e.message,true)}
    };

    document.getElementById('tk-types').addEventListener('click',async event=>{
      const btn=event.target.closest('[data-tk-type-del]');
      if(!btn)return;
      try{
        await api(`/api/guild/${currentGuild}/ticket-setup/types/${btn.dataset.tkTypeDel}`,{method:'DELETE'});
        toast('Ticket type deleted.');
        renderTickets();
      }catch(e){toast(e.message,true)}
    });

    document.getElementById('tk-post-panel').onclick=async()=>{
      const btn=document.getElementById('tk-post-panel');
      const typeIds=Array.from(document.querySelectorAll('.tk-type-box:checked')).map(box=>Number(box.value));
      btn.disabled=true;
      btn.textContent='Posting…';
      try{
        await api(`/api/guild/${currentGuild}/ticket-setup/panel`,{method:'POST',body:JSON.stringify({
          channelId:document.getElementById('tk-panel-channel').value,
          title:document.getElementById('tk-panel-title').value.trim(),
          description:document.getElementById('tk-panel-desc').value.trim(),
          typeIds
        })});
        toast('Ticket panel posted.');
        renderTickets();
      }catch(e){
        toast(e.message,true);
        btn.disabled=false;
        btn.textContent='Post ticket panel →';
      }
    };
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load tickets</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}



/* ZERON ROUND 5: custom commands + embed builder */
async function renderCustomCommands(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading commands…</p></div>';
  try{
    const d=await api(`/api/guild/${currentGuild}/custom-commands`);
    const colorOpts=sel=>TK_COLORS.map(([n,v])=>`<option value="${v}" ${v===sel?'selected':''}>${n}</option>`).join('');
    const chOpts='<option value="">— Choose a channel —</option>'+channels.map(c=>`<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
    const rows=d.commands.length
      ? d.commands.map(c=>`<div class="rr-row"><span class="rw-level-badge">${escapeHtml(d.prefix)}${escapeHtml(c.name)}</span><span class="rr-info">${c.kind==='embed'?'Embed':'Text'} · ${escapeHtml(c.content.slice(0,60))}${c.content.length>60?'…':''}</span><button type="button" class="rw-remove" data-cc-del="${c.id}">Delete</button></div>`).join('')
      : '<div class="rw-empty"><b>No commands yet</b><span>Create one below.</span></div>';

    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">COMMUNITY · COMMANDS</div><h3 class="rw-title">Custom commands</h3><p class="rw-sub">Members type ${escapeHtml(d.prefix)}name in chat and the bot replies. Up to ${d.limit} commands.</p></div></div>
      <div class="rr-list" id="cc-list">${rows}</div>
      ${ccStats(d)}
      <div class="set-title sp-section">New command</div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Command name</label><input id="cc-name" class="rr-input" maxlength="20" placeholder="rules"></div>
        <div class="field"><label>Reply type</label><select id="cc-kind"><option value="text">Plain text</option><option value="embed">Embed card</option></select></div>
        <div class="field"><label>Message</label><textarea id="cc-content" class="rr-textarea" maxlength="2000" placeholder="The reply text"></textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
        <div class="field"><label>Embed title (embed only)</label><input id="cc-title" class="rr-input" maxlength="256" placeholder="Server rules"></div>
        
        <div class="field"><label>Image link (optional, embed only)</label><input id="cc-image" class="rr-input" maxlength="500" placeholder="https://"></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="cc-create">Create command →</button></div>

    </div>`;

    document.getElementById('cc-create').onclick=async()=>{
      try{
        await api(`/api/guild/${currentGuild}/custom-commands`,{method:'POST',body:JSON.stringify({
          name:document.getElementById('cc-name').value.trim(),
          kind:document.getElementById('cc-kind').value,
          content:document.getElementById('cc-content').value.trim(),
          title:document.getElementById('cc-title').value.trim(),
          imageUrl:document.getElementById('cc-image').value.trim()
        })});
        toast('Command created.');
        renderCustomCommands();
      }catch(e){toast(e.message,true)}
    };

    document.getElementById('cc-list').addEventListener('click',async event=>{
      const btn=event.target.closest('[data-cc-del]');
      if(!btn)return;
      try{
        await api(`/api/guild/${currentGuild}/custom-commands/${btn.dataset.ccDel}`,{method:'DELETE'});
        toast('Command deleted.');
        renderCustomCommands();
      }catch(e){toast(e.message,true)}
    });

  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load commands</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}

async function renderEmbedBuilder(){
  const chOpts='<option value="">— Choose a channel —</option>'+channels.map(c=>`<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  content.innerHTML=panel('Embed builder','Build a rich embed and post it to any channel. Add a divider line by writing --- on its own line in the description.',`
    <div class="rr-form" style="grid-template-columns:1fr">
      <div class="field"><label>Channel</label><select id="eb-channel">${chOpts}</select></div>
      <div class="field"><label>Title</label><input id="eb-title" class="rr-input" maxlength="256" placeholder="Title"></div>
      <div class="field"><label>Description</label><textarea id="eb-desc" class="rr-textarea" maxlength="2000" placeholder="Description"></textarea><p class="rw-sub">Write --- on its own line to add a divider. This also works in other customizable messages.</p></div>
      <div class="field"><button type="button" class="btn" id="eb-color-toggle">＋ Add a hex color (optional)</button></div>
      <div class="field" id="eb-color-wrap" hidden><label>Hex color (optional)</label><input id="eb-color" class="rr-input" maxlength="7" placeholder="#46BBFF"><p class="rw-sub">Leave it empty to use your server's accent color.</p></div>
      <div class="field"><label>Image (optional, PNG, JPG, GIF, or WEBP, 2 MB max)</label><input type="file" id="eb-image-file" accept="image/png,image/jpeg,image/gif,image/webp"></div>
    </div>
    <div class="rewards-actions"><button type="button" class="btn primary" id="eb-post">Post embed →</button></div>`,false);
    document.getElementById('eb-color-toggle').onclick=()=>{const w=document.getElementById('eb-color-wrap');w.hidden=!w.hidden;};
    document.getElementById('eb-post').onclick=async()=>{
      const btn=document.getElementById('eb-post');
      btn.disabled=true;
      btn.textContent='Posting…';
      try{
        const imageFile=document.getElementById('eb-image-file').files[0];
        let uploadId='';
        if(imageFile){
          if(imageFile.size>2*1024*1024) throw new Error('The image must be 2 MB or smaller.');
          const up=await fetch(`/api/guild/${currentGuild}/embed-image`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':imageFile.type},body:imageFile});
          const upData=await up.json().catch(()=>({}));
          if(!up.ok) throw new Error(upData.error||'Image upload failed.');
          uploadId=upData.uploadId;
        }
        await api(`/api/guild/${currentGuild}/embeds`,{method:'POST',body:JSON.stringify({
          channelId:document.getElementById('eb-channel').value,
          title:document.getElementById('eb-title').value.trim(),
          description:document.getElementById('eb-desc').value.trim(),
          uploadId,
          imageUrl:'',
          color:(document.getElementById('eb-color-wrap').hidden?'':document.getElementById('eb-color').value.trim())
        })});
        toast('Embed posted.');
      }catch(e){
        toast(e.message,true);
      }finally{
        btn.disabled=false;
        btn.textContent='Post embed →';
      }
    };
}

/* ZERON: birthday announcement settings */
async function renderBirthdays(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading birthdays…</p></div>';
  try{
    const d=await api(`/api/guild/${currentGuild}/birthdays`);
    const chOpts='<option value="">— No announcements —</option>'+d.textChannels.map(c=>`<option value="${c.id}" ${c.id===d.config.channel_id?'selected':''}>#${escapeHtml(c.name)}</option>`).join('');
    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">COMMUNITY · BIRTHDAYS</div><h3 class="rw-title">Birthdays</h3><p class="rw-sub">Members save their birthday with /birthday set. On the day, ZERON posts a card in the channel below.</p></div></div>
      ${bdStats(d)}
      <div class="toggle-row"><div><b>Announce birthdays</b><small>Post a card when someone's birthday is today.</small></div><input class="switch" type="checkbox" id="bd-enabled" ${d.config.enabled?'checked':''}></div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Announcement channel</label><select id="bd-channel">${chOpts}</select></div>
        <div class="field"><label>Message (use {users} for the mentions)</label><textarea id="bd-message" class="rr-textarea" maxlength="500">${escapeHtml(d.config.message)}</textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="bd-save">Save birthday settings →</button></div>
    </div>`;
    document.getElementById('bd-save').onclick=async()=>{
      const btn=document.getElementById('bd-save');
      btn.disabled=true;
      btn.textContent='Saving…';
      try{
        await api(`/api/guild/${currentGuild}/birthdays`,{method:'PUT',body:JSON.stringify({
          channelId:document.getElementById('bd-channel').value,
          message:document.getElementById('bd-message').value.trim(),
          enabled:document.getElementById('bd-enabled').checked
        })});
        toast('Birthday settings saved.');
      }catch(e){
        toast(e.message,true);
      }finally{
        btn.disabled=false;
        btn.textContent='Save birthday settings →';
      }
    };
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load birthdays</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}

/* ZERON PHASE 1: user menu in the top bar */
(function nxUserMenu(){
  const profile=document.getElementById('profile');
  if(!profile)return;
  profile.style.position='relative';
  profile.style.cursor='pointer';
  profile.setAttribute('role','button');
  profile.setAttribute('tabindex','0');
  let menu=null;
  const close=()=>{if(menu){menu.remove();menu=null;}};
  const open=()=>{
    menu=document.createElement('div');
    menu.className='nx-user-menu';
    menu.innerHTML=`<div class="nx-um-name">${escapeHtml(me?(me.global_name||me.username):'Signed in')}</div><button type="button" class="nx-um-item" data-um="servers">Your servers</button><button type="button" class="nx-um-item nx-um-logout" data-um="logout">Log out</button>`;
    menu.addEventListener('click',async e=>{
      e.stopPropagation();
      const item=e.target.closest('[data-um]');
      if(!item)return;
      close();
      if(item.dataset.um==='servers'){renderPage('servers');return;}
      try{await fetch('/api/logout',{method:'POST',credentials:'same-origin'});}catch(_){}
      location.href='/';
    });
    profile.appendChild(menu);
  };
  profile.addEventListener('click',e=>{
    e.stopPropagation();
    if(menu){close();return;}
    open();
  });
  document.addEventListener('click',close);
})();

/* ZERON PHASE 2: mobile drawer */
(function nxDrawer(){
  const btn=document.getElementById('menu-toggle');
  const sidebar=document.querySelector('.sidebar');
  if(!btn||!sidebar)return;
  const backdrop=document.createElement('div');
  backdrop.className='drawer-backdrop';
  document.body.appendChild(backdrop);
  const setOpen=open=>{
    document.body.classList.toggle('drawer-open',open);
    btn.setAttribute('aria-expanded',String(open));
  };
  btn.addEventListener('click',()=>setOpen(!document.body.classList.contains('drawer-open')));
  backdrop.addEventListener('click',()=>setOpen(false));
  sidebar.addEventListener('click',e=>{if(e.target.closest('.nav'))setOpen(false);});
})();

/* ZERON: Event Management */
async function renderEvents(){
  content.innerHTML='<div class="panel card"><p class="muted">Loading events…</p></div>';
  try{
    const data=await api(`/api/guild/${currentGuild}/events`);
    const statusLabel=value=>String(value||'').replaceAll('_',' ');
    const eventCards=data.events.length?data.events.map(event=>`
      <article class="panel card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">
          <div style="min-width:0;flex:1">
            <div class="eyebrow">EVENT #${event.id} · ${escapeHtml(event.event_type.replaceAll('_',' '))}</div>
            <h3 style="margin:5px 0 7px">${escapeHtml(event.name)}</h3>
            <p class="muted" style="margin:0">${escapeHtml(event.custom_message||event.description||'No custom announcement message.')}</p>
            <div class="muted" style="font-size:12px;margin-top:10px">${escapeHtml(statusLabel(event.status))} · ${event.participantCount}/${event.capacity} participants</div>
          </div>
          <button class="btn" type="button" data-event-view="${event.id}">Manage →</button>
        </div>
      </article>`).join(''):'<div class="panel card empty"><h3>No events yet</h3><p>Create your first event below. Events begin as drafts until registration is opened.</p></div>';
    const channelOptions=data.channels.length
      ? data.channels.map(channel=>`<option value="${channel.id}">#${escapeHtml(channel.name)}</option>`).join('')
      : '<option value="" disabled selected>No text channels found — check ZERON channel access</option>';
    const createForm=data.isAdmin?`
      <div class="panel card" style="margin-bottom:18px">
        <div class="eyebrow">COMMUNITY · EVENTS</div><h3>Create an event</h3>
        <form id="event-create-form">
          <div class="form-grid">
            <div class="field"><label for="event-name">Event name</label><input id="event-name" name="name" maxlength="80" minlength="3" required placeholder="Summer 1v1 Tournament"></div>
            <div class="field"><label for="event-type">Format</label><select id="event-type" name="type" required>
              <option value="1v1_tournament">1v1 Tournament</option><option value="team_vs_team">Team vs Team</option><option value="free_for_all">Free-for-All</option><option value="custom">Custom Event</option>
            </select></div>
            <div class="field"><label for="event-capacity">Player capacity</label><input id="event-capacity" name="capacity" type="number" min="2" max="1000" value="32" required></div>
            <div class="field"><label for="event-announcement-channel">Announcement channel</label><select id="event-announcement-channel" name="announcementChannelId" required><option value="">— Choose an announcement channel —</option>${channelOptions}</select><small class="muted">ZERON will post every event update in this channel.</small></div>
            <div class="field" style="grid-column:1/-1">
              <label for="event-custom-message">Custom announcement message</label>
              <textarea id="event-custom-message" name="customMessage" maxlength="3500" rows="7" placeholder="Write your event details, rules, schedule, prizes, or any information members should see…"></textarea>
              <small class="muted">Discord Markdown is supported: **bold**, *italic*, headings with #, and --- separators.</small>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label>Live announcement preview · Components V2</label>
              <div id="event-announcement-preview" style="background:#202225;border:1px solid #ffffff20;border-left:4px solid var(--accent,#46bbff);border-radius:12px;padding:16px;color:#f2f3f5;max-width:720px">
                <div style="font-size:11px;letter-spacing:.12em;color:#aeb4bf">ZERON · EVENT ANNOUNCEMENT</div>
                <h3 id="event-preview-title" style="margin:8px 0 12px">🎉 Your event name — Registration Open</h3>
                <div id="event-preview-message" style="white-space:pre-wrap;overflow-wrap:anywhere;color:#dcddde">Your custom announcement message will appear here.</div>
                <div style="height:1px;background:#ffffff20;margin:14px 0"></div>
                <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:#c7c9ce">
                  <span><strong>Format</strong> · <span id="event-preview-format">1v1 tournament</span></span>
                  <span><strong>Players</strong> · <span id="event-preview-capacity">0/32</span></span>
                  <span><strong>Registration</strong> · 🟢 OPEN</span>
                </div>
                <div style="margin-top:16px"><span style="display:inline-block;background:#248046;color:white;border-radius:6px;padding:8px 18px;font-weight:700">Register</span></div>
                <div style="font-size:11px;color:#9da3ad;margin-top:12px">ZERON · Registration Open</div>
              </div>
            </div>
          </div>
          <button class="btn primary" type="submit" ${data.channels.length?'':'disabled'}>Create draft event</button>
        </form>
      </div>`: '';
    content.innerHTML=`<div class="panel card" style="margin-bottom:18px"><div class="eyebrow">ZERON · COMMUNITY</div><h2 style="margin:5px 0">Event Management</h2><p class="muted" style="margin:0">${data.isAdmin?'Create and manage events for this server.':'You can manage only the events where you have been assigned as staff.'}</p></div>${createForm}<div class="section-head"><div><h3>Events</h3><p class="muted">Drafts, registration, live events and history.</p></div></div>${eventCards}`;
    const form=document.getElementById('event-create-form');
    form?.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      const payload={name:form.elements.namedItem('name').value.trim(),type:form.elements.namedItem('type').value,capacity:Number(form.elements.namedItem('capacity').value),customMessage:form.elements.namedItem('customMessage').value,announcementChannelId:form.elements.namedItem('announcementChannelId').value};
      button.disabled=true;button.textContent='Creating…';
      try{await api(`/api/guild/${currentGuild}/events`,{method:'POST',body:JSON.stringify(payload)});toast('Draft event created.');await renderEvents();}
      catch(error){toast(error.message,true);button.disabled=false;button.textContent='Create draft event';}
    });
    const previewMarkup=value=>escapeHtml(value||'').replace(/^### (.+)$/gm,'<strong style="font-size:1.05em">$1</strong>').replace(/^## (.+)$/gm,'<strong style="font-size:1.12em">$1</strong>').replace(/^# (.+)$/gm,'<strong style="font-size:1.2em">$1</strong>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/__(.+?)__/g,'<u>$1</u>').replace(/~~(.+?)~~/g,'<s>$1</s>').replace(/`([^`]+)`/g,'<code style="background:#111;padding:2px 4px;border-radius:4px">$1</code>').replace(/^---$/gm,'<span style="display:block;border-top:1px solid #ffffff30;margin:10px 0"></span>');
    const syncEventPreview=()=>{
      const name=document.getElementById('event-name')?.value.trim()||'Your event name';
      const type=document.getElementById('event-type')?.selectedOptions[0]?.textContent||'1v1 Tournament';
      const capacity=document.getElementById('event-capacity')?.value||'32';
      const message=document.getElementById('event-custom-message')?.value||'Your custom announcement message will appear here.';
      document.getElementById('event-preview-title').textContent='🎉 '+name+' — Registration Open';
      document.getElementById('event-preview-format').textContent=type;
      document.getElementById('event-preview-capacity').textContent='0/'+capacity;
      document.getElementById('event-preview-message').innerHTML=previewMarkup(message);
    };
    ['event-name','event-type','event-capacity','event-custom-message'].forEach(id=>document.getElementById(id)?.addEventListener('input',syncEventPreview));
    syncEventPreview();
    content.querySelectorAll('[data-event-view]').forEach(button=>button.addEventListener('click',()=>renderEventDetails(button.dataset.eventView)));
  }catch(error){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load Event Management</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function renderEventDetails(eventId){
  content.innerHTML='<div class="panel card"><p class="muted">Loading event details…</p></div>';
  try{
    const data=await api(`/api/guild/${currentGuild}/events/${eventId}`);
    const event=data.event;
    const canHost=data.isAdmin||data.staffRoles.includes('host');
    const canRecordResults=data.isAdmin||data.staffRoles.some(role=>['host','referee','scorekeeper'].includes(role));
    const isTournament=event.event_type==='1v1_tournament';
    const matches=Array.isArray(data.matches)?data.matches:[];
    const transitions={draft:['registration_open','cancelled'],registration_open:['registration_locked','cancelled'],registration_locked:['preparing','cancelled'],preparing:['active','cancelled'],active:['paused','completed','cancelled'],paused:['active','cancelled'],completed:[],cancelled:[]};
    const availableTransitions=(transitions[event.status]||[]).filter(status=>!(isTournament&&event.status==='registration_locked'&&status==='preparing'));
    const actions=canHost?availableTransitions.map(status=>`<button type="button" class="btn ${status==='completed'?'primary':''}" data-event-status="${status}">${status==='registration_open'?'Open registration':status.replaceAll('_',' ')}</button>`).join(''):'';
    const participants=data.participants.length?data.participants.map((person,index)=>`<div class="rr-row"><span class="rw-level-badge">${index+1}</span><span class="rr-info">${escapeHtml(person.user_id)}</span><span class="muted">${new Date(person.joined_at).toLocaleDateString()}</span></div>`).join(''):'<p class="muted">No participants registered yet.</p>';
    const staff=data.staff.length?data.staff.map(person=>`<div class="rr-row"><span class="rr-info">${escapeHtml(person.user_id)}</span><span class="rw-level-badge">${escapeHtml(person.role)}</span>${data.isAdmin?`<button type="button" class="btn" data-staff-remove="${escapeHtml(person.user_id)}" data-staff-role="${escapeHtml(person.role)}">Remove</button>`:''}</div>`).join(''):'<p class="muted">No event staff assigned.</p>';
    const staffTools=data.isAdmin?`<div style="margin-top:14px"><div class="field"><label for="event-staff-search">Find a server member</label><input id="event-staff-search" maxlength="32" placeholder="Search username or server nickname"><div id="event-staff-results" style="display:grid;gap:6px;margin-top:8px"></div></div><div class="field"><label for="event-staff-role">Staff role</label><select id="event-staff-role"><option value="host">Event Host</option><option value="referee">Referee</option><option value="scorekeeper">Scorekeeper</option></select></div><p class="muted">Event staff can access only the events they are assigned to.</p></div>`:'';
    const announcementTools=`<div class="panel card" style="margin-bottom:14px"><h3>Automatic announcements</h3><p class="muted">Every event update is posted automatically in <strong>#${escapeHtml(data.channels.find(channel=>channel.id===event.announcement_channel_id)?.name||'selected channel')}</strong>. Round results are announced after the full round is complete.</p></div>`;
    const completedEventTools=data.isAdmin&&event.status==='completed'
      ? `<div class="panel card" style="margin-bottom:14px"><h3>Manage completed event</h3><p class="muted">Delete this completed event and its participants, matches, scores, staff assignments and activity history.</p><button type="button" class="btn" id="event-delete-completed">Delete completed event</button></div>`
      : '';
    const activity=data.activity.length?data.activity.map(item=>`<div class="rr-row"><span class="rr-info">${escapeHtml(item.action.replaceAll('_',' '))}</span><small class="muted">${new Date(item.created_at).toLocaleString()}</small></div>`).join(''):'<p class="muted">No activity recorded yet.</p>';

    let bracketTools='';
    let matchesPanel='';
    if(isTournament){
      if(!matches.length&&event.status==='registration_locked'){
        bracketTools=canHost
          ?'<div class="panel card" style="margin-bottom:14px"><h3>Tournament bracket</h3><p class="muted">Registration is locked. Generate the randomized single-elimination bracket to create the first round of matches.</p><button type="button" class="btn primary" id="event-generate-bracket">Generate bracket</button></div>'
          :'<div class="panel card" style="margin-bottom:14px"><h3>Tournament bracket</h3><p class="muted">The event host needs to generate the bracket.</p></div>';
      }else if(!matches.length){
        bracketTools='<div class="panel card" style="margin-bottom:14px"><h3>Tournament bracket</h3><p class="muted">The bracket becomes available after registration is locked.</p></div>';
      }
      if(matches.length){
        const rounds=[...new Set(matches.map(match=>Number(match.round_number)))].sort((a,b)=>a-b);
        const participantLabel=id=>{
          if(!id)return 'TBD';
          const person=data.participants.find(item=>String(item.user_id)===String(id));
          return person?String(person.user_id):String(id);
        };
        const roundHtml=rounds.map(round=>{
          const roundMatches=matches.filter(match=>Number(match.round_number)===round);
          const cards=roundMatches.map(match=>{
            const complete=match.status==='completed';
            const winner=match.winner_id?participantLabel(match.winner_id):'';
            const resultForm=!complete&&event.status==='active'&&canRecordResults
              ?`<form class="event-match-result" data-match-result="${match.id}" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto;gap:8px;align-items:end;margin-top:12px">
                  <div class="field" style="margin:0"><label for="match-${match.id}-score-a">Score — Player A</label><input id="match-${match.id}-score-a" name="scoreA" type="number" min="0" max="1000000" step="1" required></div>
                  <div class="field" style="margin:0"><label for="match-${match.id}-score-b">Score — Player B</label><input id="match-${match.id}-score-b" name="scoreB" type="number" min="0" max="1000000" step="1" required></div>
                  <button class="btn primary" type="submit">Save result</button>
                </form>`:'';
            return `<div class="panel card" style="margin:0">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
                <strong>Match ${match.match_number}</strong>
                <span class="pill">${complete?'Completed':'Pending'}</span>
              </div>
              <div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;margin-top:12px;align-items:center">
                <span style="overflow-wrap:anywhere">${escapeHtml(participantLabel(match.participant_a))}</span><strong>VS</strong>
                <span style="overflow-wrap:anywhere">${escapeHtml(participantLabel(match.participant_b))}</span>
              </div>
              ${complete?`<p class="muted" style="margin:10px 0 0">Winner: <strong>${escapeHtml(winner)}</strong></p>`:resultForm||'<p class="muted" style="margin:10px 0 0">Waiting for the event to become active or for assigned staff to enter the result.</p>'}
            </div>`;
          }).join('');
          return `<section style="margin-top:16px"><h4 style="margin:0 0 10px">Round ${round}</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:10px">${cards}</div></section>`;
        }).join('');
        matchesPanel=`<div class="panel card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h3 style="margin:0">Tournament matches</h3><p class="muted" style="margin:5px 0 0">${matches.length} match(es) across ${rounds.length} round(s). Results advance winners automatically.</p></div></div>${roundHtml}</div>`;
      }
    }

    content.innerHTML=`
      <div class="panel card" style="margin-bottom:14px">
        <button type="button" class="btn" id="event-back">← All events</button>
        <div class="eyebrow" style="margin-top:16px">EVENT #${event.id} · ${escapeHtml(event.event_type.replaceAll('_',' '))}</div>
        <h2 style="margin:5px 0">${escapeHtml(event.name)}</h2>
        <div class="muted" style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(event.custom_message||event.description||'No custom announcement message.')}</div>
        <div class="stats" style="margin:18px 0"><div class="stat"><div class="stat-label">STATUS</div><div class="stat-value" style="font-size:18px">${escapeHtml(event.status.replaceAll('_',' '))}</div></div><div class="stat"><div class="stat-label">REGISTERED</div><div class="stat-value">${data.participants.length}/${event.capacity}</div></div><div class="stat"><div class="stat-label">STAFF</div><div class="stat-value">${data.staff.length}</div></div></div>
        ${actions?'<div style="display:flex;gap:8px;flex-wrap:wrap">'+actions+'</div>':''}
      </div>
      <div class="panel card" style="margin-bottom:14px"><h3>Participants</h3>${participants}</div>
      ${bracketTools}
      ${matchesPanel}
      <div class="panel card" style="margin-bottom:14px"><h3>Event staff</h3>${staff}${staffTools}</div>
      ${announcementTools}
      ${completedEventTools}
      <div class="panel card"><h3>Activity log</h3>${activity}</div>`;
    document.getElementById('event-back')?.addEventListener('click',renderEvents);
    document.getElementById('event-delete-completed')?.addEventListener('click',async buttonEvent=>{
      const button=buttonEvent.currentTarget;
      if(!window.confirm(`Delete completed event "${event.name}"? This also deletes its participants, matches, scores, staff assignments and activity history. This cannot be undone.`)) return;
      button.disabled=true;
      button.textContent='Deleting…';
      try{
        await api(`/api/guild/${currentGuild}/events/${eventId}`,{method:'DELETE'});
        toast('Completed event deleted.');
        await renderEvents();
      }catch(error){
        toast(error.message,true);
        button.disabled=false;
        button.textContent='Delete completed event';
      }
    });

    document.getElementById('event-generate-bracket')?.addEventListener('click',async buttonEvent=>{
      const button=buttonEvent.currentTarget;
      button.disabled=true;button.textContent='Generating…';
      try{
        await api(`/api/guild/${currentGuild}/events/${eventId}/bracket`,{method:'POST',body:JSON.stringify({})});
        toast('Tournament bracket generated.');
        await renderEventDetails(eventId);
      }catch(error){toast(error.message,true);button.disabled=false;button.textContent='Generate bracket';}
    });

    content.querySelectorAll('[data-match-result]').forEach(form=>{
      form.addEventListener('submit',async submitEvent=>{
        submitEvent.preventDefault();
        const button=form.querySelector('button[type="submit"]');
        const scoreA=Number(form.elements.namedItem('scoreA').value);
        const scoreB=Number(form.elements.namedItem('scoreB').value);
        if(scoreA===scoreB)return toast('A tied score needs to be resolved before saving the result.',true);
        button.disabled=true;button.textContent='Saving…';
        try{
          await api(`/api/guild/${currentGuild}/events/${eventId}/matches/${form.dataset.matchResult}/result`,{method:'POST',body:JSON.stringify({scoreA,scoreB})});
          toast('Match result saved.');
          await renderEventDetails(eventId);
        }catch(error){toast(error.message,true);button.disabled=false;button.textContent='Save result';}
      });
    });

    const staffSearch=document.getElementById('event-staff-search');
    const staffResults=document.getElementById('event-staff-results');
    let staffSearchTimer;
    staffSearch?.addEventListener('input',()=>{
      clearTimeout(staffSearchTimer);
      const query=staffSearch.value.trim();
      if(query.length<2){staffResults.innerHTML='';return;}
      staffSearchTimer=setTimeout(async()=>{
        try{
          const result=await api(`/api/guild/${currentGuild}/events/members?q=${encodeURIComponent(query)}`);
          staffResults.innerHTML=result.members.length?result.members.map(member=>`<button type="button" class="btn" data-staff-add="${escapeHtml(member.id)}">${escapeHtml(member.displayName)} · @${escapeHtml(member.username)}</button>`).join(''):'<small class="muted">No matching members found.</small>';
          staffResults.querySelectorAll('[data-staff-add]').forEach(button=>button.addEventListener('click',async()=>{
            const role=document.getElementById('event-staff-role').value;
            button.disabled=true;
            try{await api(`/api/guild/${currentGuild}/events/${eventId}/staff`,{method:'POST',body:JSON.stringify({userId:button.dataset.staffAdd,role})});toast('Event staff assigned.');await renderEventDetails(eventId);}
            catch(error){toast(error.message,true);button.disabled=false;}
          }));
        }catch(error){staffResults.innerHTML=`<small class="muted">${escapeHtml(error.message)}</small>`;}
      },250);
    });
    content.querySelectorAll('[data-staff-remove]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{await api(`/api/guild/${currentGuild}/events/${eventId}/staff/${button.dataset.staffRemove}/${button.dataset.staffRole}`,{method:'DELETE'});toast('Event staff removed.');await renderEventDetails(eventId);}
      catch(error){toast(error.message,true);button.disabled=false;}
    }));

    content.querySelectorAll('[data-event-status]').forEach(button=>button.addEventListener('click',async()=>{
      const status=button.dataset.eventStatus;button.disabled=true;
      try{await api(`/api/guild/${currentGuild}/events/${eventId}/status`,{method:'POST',body:JSON.stringify({status})});toast('Event status updated.');await renderEventDetails(eventId);}
      catch(error){toast(error.message,true);button.disabled=false;}
    }));
  }catch(error){content.innerHTML=`<div class="panel card empty"><h3>Could not load event</h3><p>${escapeHtml(error.message)}</p><button class="btn" id="event-back">Back to events</button></div>`;document.getElementById('event-back')?.addEventListener('click',renderEvents);}
}

/* ZERON: giveaways */
async function renderGiveaways(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading giveaways…</p></div>';
  try{
    const d=await api(`/api/guild/${currentGuild}/giveaways`);
    const chOpts='<option value="">— Choose a channel —</option>'+d.textChannels.map(c=>`<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
    const roleOpts='<option value="">— No role needed —</option>'+d.roles.map(r=>`<option value="${r.id}">@ ${escapeHtml(r.name)}</option>`).join('');
    const colorOpts=TK_COLORS.map(([n,v])=>`<option value="${v}">${n}</option>`).join('');
    const endsText=g=>g.status==='active'
      ? 'Ends '+new Date(g.ends_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
      : 'Ended';
    const list=d.giveaways.length
      ? d.giveaways.map(g=>`<div class="rr-row"><span class="rw-level-badge">${g.status==='active'?'LIVE':'ENDED'}</span><span class="rr-info">${escapeHtml(g.title)} · #${escapeHtml(g.channel_name||'unknown')} · ${g.entries} entries · ${endsText(g)}</span>${g.status==='active'?`<button type="button" class="btn" data-gw-end="${g.id}">End now</button>`:`<button type="button" class="btn" data-gw-reroll="${g.id}">Reroll</button>`}</div>`).join('')
      : '<div class="rw-empty"><b>No giveaways yet</b><span>Create one below.</span></div>';

    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">COMMUNITY · GIVEAWAYS</div><h3 class="rw-title">Giveaways</h3><p class="rw-sub">Members press the button to enter. Winners are drawn when the timer ends.</p></div></div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Channel</label><select id="gw-channel">${chOpts}</select></div>
        <div class="field"><label>Prize</label><input id="gw-title" class="rr-input" maxlength="100" placeholder="Discord Nitro (1 month)"></div>
        <div class="field"><label>Description (optional)</label><textarea id="gw-desc" class="rr-textarea" maxlength="500" placeholder="Rules and details"></textarea></div>
        <div class="field"><label>Winners (1 to 10)</label><input id="gw-winners" class="rr-input" type="number" min="1" max="10" value="1"></div>
        <div class="field"><label>Duration in minutes (1 to 43200)</label><input id="gw-minutes" class="rr-input" type="number" min="1" max="43200" value="60"></div>
        <div class="field"><label>Minimum level (0 means none)</label><input id="gw-level" class="rr-input" type="number" min="0" max="999" value="0"></div>
        <div class="field"><label>Required role</label><select id="gw-role">${roleOpts}</select></div>
        
      </div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="gw-create">Start giveaway →</button></div>
      ${gwStats(d)}
      <div class="set-title sp-section">Giveaways</div>
      <div class="rr-list" id="gw-list">${list}</div>
    </div>`;

    document.getElementById('gw-create').onclick=async()=>{
      const btn=document.getElementById('gw-create');
      btn.disabled=true;
      btn.textContent='Starting…';
      try{
        await api(`/api/guild/${currentGuild}/giveaways`,{method:'POST',body:JSON.stringify({
          channelId:document.getElementById('gw-channel').value,
          title:document.getElementById('gw-title').value.trim(),
          description:document.getElementById('gw-desc').value.trim(),
          winners:Number(document.getElementById('gw-winners').value),
          durationMinutes:Number(document.getElementById('gw-minutes').value),
          minLevel:Number(document.getElementById('gw-level').value||0),
          roleId:document.getElementById('gw-role').value
        })});
        toast('Giveaway started.');
        renderGiveaways();
      }catch(e){
        toast(e.message,true);
        btn.disabled=false;
        btn.textContent='Start giveaway →';
      }
    };

    document.getElementById('gw-list').addEventListener('click',async e=>{
      const endBtn=e.target.closest('[data-gw-end]');
      const rerollBtn=e.target.closest('[data-gw-reroll]');
      try{
        if(endBtn){
          await api(`/api/guild/${currentGuild}/giveaways/${endBtn.dataset.gwEnd}/end`,{method:'POST'});
          toast('Giveaway ended.');
          renderGiveaways();
        }else if(rerollBtn){
          const r=await api(`/api/guild/${currentGuild}/giveaways/${rerollBtn.dataset.gwReroll}/reroll`,{method:'POST'});
          toast(r.winners.length?'New winner drawn.':'No valid entries to reroll.');
          renderGiveaways();
        }
      }catch(err){
        toast(err.message,true);
      }
    });
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load giveaways</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}

/* ZERON: auto moderation */
async function renderAutomod(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading auto moderation…</p></div>';
  try{
    const c=await api(`/api/guild/${currentGuild}/automod`);
    const linkOpt=(v,l)=>`<option value="${v}" ${c.link_mode===v?'selected':''}>${l}</option>`;
    content.innerHTML=`<div class="panel card rw-card">
      <div class="rw-top"><div><div class="eyebrow">MODERATION · AUTOMOD</div><h3 class="rw-title">Auto moderation</h3><p class="rw-sub">Messages that break these rules are removed and logged. Staff with Manage Messages are exempt.</p></div></div>
      <div class="toggle-row"><div><b>Turn automod on</b><small>Checks every message as it arrives.</small></div><input class="switch" type="checkbox" id="am-enabled" ${c.enabled?'checked':''}></div>
      <div class="rr-form" style="grid-template-columns:1fr">
        <div class="field"><label>Blocked words (one per line or comma separated)</label><textarea id="am-words" class="rr-textarea" placeholder="badword, another">${escapeHtml(c.bad_words.join('\n'))}</textarea></div>
        <div class="field"><label>Links</label><select id="am-links">${linkOpt('off','Allow links')}${linkOpt('invites','Block Discord invites only')}${linkOpt('all','Block all links')}</select></div>
        <div class="field"><label>Max mentions per message (0 means no limit)</label><input id="am-mentions" class="rr-input" type="number" min="0" max="20" value="${c.max_mentions}"></div>
        <div class="field"><label>Strikes before timeout (0 means never)</label><input id="am-strikes" class="rr-input" type="number" min="0" max="10" value="${c.strike_limit}"></div>
        <div class="field"><label>Timeout length in minutes</label><input id="am-timeout" class="rr-input" type="number" min="1" max="1440" value="${c.timeout_minutes}"></div>
      </div>
      <div class="rewards-actions"><button type="button" class="btn primary" id="am-save">Save auto moderation →</button></div>
    </div>`;

    document.getElementById('am-save').onclick=async()=>{
      const btn=document.getElementById('am-save');
      const words=document.getElementById('am-words').value.split(/[\n,]+/).map(w=>w.trim()).filter(Boolean);
      btn.disabled=true;
      btn.textContent='Saving…';
      try{
        await api(`/api/guild/${currentGuild}/automod`,{method:'PUT',body:JSON.stringify({
          enabled:document.getElementById('am-enabled').checked,
          bad_words:words,
          link_mode:document.getElementById('am-links').value,
          max_mentions:Number(document.getElementById('am-mentions').value),
          strike_limit:Number(document.getElementById('am-strikes').value),
          timeout_minutes:Number(document.getElementById('am-timeout').value)
        })});
        toast('Auto moderation saved.');
        renderAutomod();
      }catch(e){
        toast(e.message,true);
        btn.disabled=false;
        btn.textContent='Save auto moderation →';
      }
    };
  }catch(e){
    content.innerHTML=`<div class="panel card empty"><h3>Could not load auto moderation</h3><p>${escapeHtml(e.message)}</p></div>`;
  }
}

/* NEXORA ICONS: one icon set used in the sidebar, drawer, and system cards */
function zeronIcon(key){
  const icons={"overview": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/>", "servers": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"6\" rx=\"2\"/><rect x=\"3\" y=\"14\" width=\"18\" height=\"6\" rx=\"2\"/><path d=\"M7 7h.01M7 17h.01\"/>", "analytics": "<path d=\"M3 3v18h18\"/><path d=\"M7 15l4-4 3 3 5-6\"/>", "channels": "<path d=\"M4 9h16M4 15h16M10 3L8 21M16 3l-2 18\"/>", "logs": "<path d=\"M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z\"/><path d=\"M14 3v6h6M8 13h8M8 17h8\"/>", "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/>", "bot": "<rect x=\"4\" y=\"8\" width=\"16\" height=\"12\" rx=\"3\"/><path d=\"M12 4v4M9 13h.01M15 13h.01\"/>", "welcome": "<path d=\"M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z\"/>", "autorole": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6\"/>", "reaction": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01\"/>", "roles": "<path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/>", "xp": "<path d=\"M22 7l-8.5 8.5-5-5L2 17\"/><path d=\"M16 7h6v6\"/>", "rewards": "<circle cx=\"12\" cy=\"8\" r=\"6\"/><path d=\"M15.5 13.5L17 22l-5-3-5 3 1.5-8.5\"/>", "birthdays": "<path d=\"M4 21v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8M4 21h16M8 11V8M12 11V8M16 11V8\"/><path d=\"M8 5h.01M12 5h.01M16 5h.01\"/>", "commands": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M7 9l3 3-3 3M13 15h4\"/>", "tickets": "<path d=\"M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 0 0-6V6H3z\"/><path d=\"M14 6v12\"/>", "giveaways": "<rect x=\"3\" y=\"8\" width=\"18\" height=\"4\" rx=\"1\"/><path d=\"M12 8v13M19 12v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8\"/><path d=\"M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5\"/>", "automod": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M5.6 5.6l12.8 12.8\"/>"};
  return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">'+(icons[key]||'')+'</svg>';
}

/* NEXORA: live bot status and installed servers on the public home */
async function nxFillPublicStats(){
  try{
    const h=await api('/health');
    const bot=document.getElementById('stat-bot');
    const guilds=document.getElementById('stat-guilds');
    if(bot)bot.textContent=h.botReady?'Online':'Offline';
    if(guilds)guilds.textContent=typeof h.guilds==='number'?String(h.guilds):'—';
  }catch(e){}
}

/* NEXORA: overview cards (members, server, activity) */
function ovHtml(st){
  if(!st) return '<div class="panel card rw-card"><p class="rw-sub">Could not load server stats.</p></div>';
  const fmt=n=>Number(n||0).toLocaleString('en-US');
  const created=st.created?new Date(st.created).toLocaleDateString('en-GB',{month:'short',year:'numeric'}):'—';
  const target=[2,7,14][st.boostLevel]||null;
  const pct=target?Math.min(100,Math.round(st.boostCount/target*100)):100;
  const net=st.joined7d-st.left7d;
  const max=Math.max(1,...st.activity);
  const bars=st.activity.map(v=>`<i style="height:${Math.max(3,Math.round(v/max*100))}%"></i>`).join('');
  return `<div class="ov-grid">
    <div class="panel card ov-card">
      <div class="ov-head"><span>Members</span><span><span class="rw-sub">Last 7 days</span> · <button type="button" class="ov-link" data-page="analytics">Analytics ↗</button></span></div>
      <div class="ov-big">${fmt(st.members)}</div>
      <div class="ov-sub"><span>↑ ${fmt(st.joined7d)} joined</span><span>↓ ${fmt(st.left7d)} left</span><span>net ${net>=0?'+':''}${net}</span></div>
    </div>
    <div class="panel card ov-card">
      <div class="ov-head"><span>Server</span><span class="rw-sub">Right now</span></div>
      <div class="ov-big ov-big-sm">Level ${st.boostLevel} · ${fmt(st.boostCount)} boosts</div>
      <div class="ov-bar"><i style="width:${pct}%"></i></div>
      <div class="ov-sub"><span>${target?fmt(target-st.boostCount)+' boosts to level '+(st.boostLevel+1):'Max boost level'}</span></div>
      <div class="ov-tiles">
        <div class="ov-tile"><b>${fmt(st.textChannels)} text · ${fmt(st.voiceChannels)} voice</b><small>Channels</small></div>
        <div class="ov-tile"><b>${fmt(st.roles)}</b><small>Roles</small></div>
        <div class="ov-tile"><b>${created}</b><small>Created</small></div>
      </div>
    </div>
    <div class="panel card ov-card">
      <div class="ov-head"><span>Activity</span><span><span class="rw-sub">Last 24 hours</span> · <button type="button" class="ov-link" data-page="analytics">Analytics ↗</button></span></div>
      <div class="ov-big">${fmt(st.messages24)}</div>
      <div class="ov-sub"><span>messages in the last 24 hours</span></div>
      <div class="ov-chart">${bars}</div>
      <div class="ov-foot"><span>24 hours ago</span><span>Now</span></div>
    </div>
  </div>`;
}

/* NEXORA: server switcher in the sidebar (replaces the page dropdown) */
function nxServerIcon(g){
  return g && g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
}
function nxRenderSideServer(){
  const box=document.getElementById('side-server-btn');
  if(!box)return;
  if(!me){box.style.display='none';return}
  box.style.display='';
  const g=guilds.find(x=>x.id===currentGuild);
  const icon=nxServerIcon(g);
  box.innerHTML=`<span class="ss-icon">${icon?`<img src="${icon}" alt="">`:escapeHtml(g?(g.name||'?').trim().charAt(0).toUpperCase():'?')}</span><span class="ss-name">${escapeHtml(g?g.name:'Choose a server')}</span><span class="ss-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>`;
}
function nxToggleServerMenu(open){
  const menu=document.getElementById('side-server-menu');
  if(!menu)return;
  const show=open===undefined?!menu.classList.contains('open'):open;
  menu.classList.toggle('open',show);
  const card=document.getElementById('side-server-card');
  if(card) card.classList.toggle('open',show);
  menu.hidden=false;
  if(show){
    menu.innerHTML=guilds.map(g=>{
      const icon=nxServerIcon(g);
      return `<button type="button" class="ss-item" data-ss-guild="${g.id}" data-installed="${g.installed?1:0}"><span class="ss-icon">${icon?`<img src="${icon}" alt="">`:escapeHtml((g.name||'?').trim().charAt(0).toUpperCase())}</span><span class="ss-name">${escapeHtml(g.name)}</span><span class="ss-tag ${g.installed?'on':''}">${g.installed?'Active':'Not added'}</span></button>`;
    }).join('')||'<div class="rw-sub">No servers found.</div>';
  }
}
document.addEventListener('click',e=>{
  const toggle=e.target.closest('#side-server-btn');
  if(toggle){nxToggleServerMenu();return}
  const item=e.target.closest('[data-ss-guild]');
  if(item){
    if(item.dataset.installed!=='1'){toast('Add ZERON to this server first.',true);return}
    currentGuild=item.dataset.ssGuild;
    guildSelect.value=currentGuild;
    refreshCustomSelect(guildSelect);
    nxToggleServerMenu(false);
    renderPage(activePage||'overview');
    return;
  }
  if(!e.target.closest('#side-server-menu'))nxToggleServerMenu(false);
});

/* NEXORA: account icon in the top bar (connect, switch account, log out) */
(function nxAccount(){
  const btn=document.getElementById('account-btn');
  const menu=document.getElementById('account-menu');
  if(!btn||!menu)return;
  const render=()=>{
    if(me){
      const avatar=me.avatar?`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`:null;
      btn.innerHTML=avatar?`<img src="${avatar}" alt="" class="account-avatar">`:`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
      menu.innerHTML=`<div class="am-name">${escapeHtml(me.global_name||me.username||'Signed in')}</div><button type="button" class="am-item" data-am="switch">Switch account</button><button type="button" class="am-item am-danger" data-am="logout">Log out</button>`;
    }else{
      menu.innerHTML=`<div class="am-text">Connect your Discord account</div><a class="am-item am-primary" data-am="connect" href="/auth/discord">Connect Discord →</a>`;
    }
  };
  const logout=async()=>{try{await fetch('/api/logout',{method:'POST',credentials:'same-origin'});}catch(_){}};
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    if(menu.hidden){render();menu.hidden=false;btn.setAttribute('aria-expanded','true');}
    else{menu.hidden=true;btn.setAttribute('aria-expanded','false');}
  });
  menu.addEventListener('click',async e=>{
    e.stopPropagation();
    const item=e.target.closest('[data-am]');
    if(!item)return;
    const action=item.dataset.am;
    if(action==='connect'){location.href='/auth/discord';return}
    if(action==='switch'){await logout();location.href='/auth/discord';return}
    if(action==='logout'){await logout();location.href='/';}
  });
  document.addEventListener('click',()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false');});
})();

/* NEXORA: bot invite for a specific server, and refresh the list when the tab is focused again */
function zeronInviteUrl(guildId){
  return 'https://discord.com/oauth2/authorize?client_id=1562743951566307419&permissions=8&integration_type=0&scope=bot+applications.commands&guild_id='+encodeURIComponent(guildId)+'&disable_guild_select=true';
}
window.addEventListener('focus',async()=>{
  if(activePage!=='servers'||!me)return;
  try{await loadGuilds();renderServers();}catch(e){}
});

/* NEXORA: stat cards at the top of the system pages */
function statGrid(tiles){
  return '<div class="stat-grid">'+tiles.map(([l,v,sub])=>`<div class="stat card"><span>${escapeHtml(String(l).toUpperCase())}</span><strong>${escapeHtml(String(v))}</strong><small>${escapeHtml(sub)}</small></div>`).join('')+'</div>';
}
function tkStats(d){
  const roles=new Set(d.types.flatMap(t=>t.support_role_ids)).size;
  return statGrid([
    ['Ticket types', d.types.length, 'Types on your panels'],
    ['Support roles', roles, 'Roles that can see tickets'],
    ['Category', d.config.category_id ? 'Set' : 'Not set', 'Where ticket channels go'],
    ['Transcript log', d.config.log_channel_id ? 'On' : 'Off', 'Saved when a ticket closes']
  ]);
}
function gwStats(d){
  const live=d.giveaways.filter(g=>g.status==='active').length;
  const entries=d.giveaways.reduce((sum,g)=>sum+Number(g.entries||0),0);
  const winners=d.giveaways.reduce((sum,g)=>sum+(g.winner_ids||[]).length,0);
  return statGrid([
    ['Live', live, 'Running right now'],
    ['Ended', d.giveaways.length-live, 'Finished giveaways'],
    ['Entries', entries, 'Across all giveaways'],
    ['Winners drawn', winners, 'Picked so far']
  ]);
}

/* NEXORA: stat cards for Custom commands and Birthdays */
function ccStats(d){
  const text=d.commands.filter(c=>c.kind!=='embed').length;
  const embeds=d.commands.filter(c=>c.kind==='embed').length;
  return statGrid([
    ['Commands', d.commands.length, 'of '+d.limit+' allowed'],
    ['Text replies', text, 'Plain text messages'],
    ['Embed replies', embeds, 'Embed cards'],
    ['Prefix', d.prefix, 'Typed before the name']
  ]);
}
function bdStats(d){
  return statGrid([
    ['Saved birthdays', d.stats.saved, 'Members who set a date'],
    ['Today', d.stats.today, 'Birthdays on this UTC day'],
    ['Announcements', d.config.enabled ? 'On' : 'Off', 'Posts a card on the day'],
    ['Channel', d.config.channel_id ? 'Set' : 'Not set', 'Where the card is posted']
  ]);
}

/* NEXORA: verification page (application form, staff review, role swap) */
async function renderVerification(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading verification…</p></div>';
  const d=await api(`/api/guild/${currentGuild}/verification`);
  const c=d.config;
  const roleOpts=sel=>'<option value="">— None —</option>'+d.roles.map(r=>`<option value="${r.id}" ${r.id===sel?'selected':''}>@ ${escapeHtml(r.name)}</option>`).join('');
  const chanOpts=sel=>'<option value="">— None —</option>'+d.channels.map(ch=>`<option value="${ch.id}" ${ch.id===sel?'selected':''}># ${escapeHtml(ch.name)}</option>`).join('');
  const qs=[0,1,2,3,4].map(i=>`<div class="field"><label>Question ${i+1}${i===0?'':' (optional)'}</label><input class="rr-input vf-q" maxlength="45" placeholder="e.g. What is your name?" value="${escapeHtml(c.questions[i]||'')}"></div>`).join('');
  content.innerHTML=panel('Verification','New members start as Unverified. They answer a short application, and staff approve or reject it.',`
    <div class="set-group"><div class="set-title">NAME AND MESSAGES</div>
      <div class="field"><label>Verification name (panel title)</label><input id="vf-title" class="rr-input" maxlength="45" placeholder="Server verification" value="${escapeHtml(c.panelTitle||'')}"></div>
      <div class="field"><label>Panel message (shown on the button panel)</label><textarea id="vf-panel-message" class="rr-input" rows="3" maxlength="1000" placeholder="Press the button below and answer a few questions.">${escapeHtml(c.panelMessage||'')}</textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
      <div class="field"><label>Approved DM (use {server} for the server name)</label><textarea id="vf-approve-message" class="rr-input" rows="2" maxlength="500" placeholder="You are verified in {server}. Welcome!">${escapeHtml(c.approveMessage||'')}</textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
      <div class="field"><label>Rejected DM (use {server} for the server name)</label><textarea id="vf-reject-message" class="rr-input" rows="2" maxlength="500" placeholder="Your verification application for {server} was not approved. You can apply again.">${escapeHtml(c.rejectMessage||'')}</textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
    </div>
    <div class="set-group"><div class="set-title">SETUP</div>
      ${toggle('Verification on','Members can apply with the panel button.','vf_enabled',c.enabled)}
      <div class="field"><label>Unverified role (give it on join in Auto-role)</label><select id="vf-unverified">${roleOpts(c.unverifiedRoleId)}</select></div>
      <div class="field"><label>Verified role (given when approved)</label><select id="vf-verified">${roleOpts(c.verifiedRoleId)}</select></div>
    </div>
    <div class="set-group"><div class="set-title">CHANNELS</div>
      <div class="field"><label>Review channel (staff see applications here)</label><select id="vf-review">${chanOpts(c.reviewChannelId)}</select></div>
      <div class="field"><label>Panel channel (members click here to apply)</label><select id="vf-panel">${chanOpts(c.panelChannelId)}</select></div>
    </div>
    <div class="set-group"><div class="set-title">APPLICATION QUESTIONS</div>${qs}</div>
    <div class="rewards-actions"><button class="btn primary" id="vf-save">Save verification</button><button class="btn" id="vf-post">Post panel</button></div>
  `,false);

  const sendJson=async(method,path,body)=>{
    const res=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});
    const out=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(out.error||'Request failed');
    return out;
  };
  document.getElementById('vf-save').onclick=async()=>{
    try{
      await sendJson('PUT',`/api/guild/${currentGuild}/verification`,{
        enabled:document.querySelector('input[name="vf_enabled"]').checked,
        unverifiedRoleId:document.getElementById('vf-unverified').value,
        verifiedRoleId:document.getElementById('vf-verified').value,
        reviewChannelId:document.getElementById('vf-review').value,
        panelChannelId:document.getElementById('vf-panel').value,
        questions:[...document.querySelectorAll('.vf-q')].map(i=>i.value),
        panelTitle:document.getElementById('vf-title').value,
        panelMessage:document.getElementById('vf-panel-message').value,
        approveMessage:document.getElementById('vf-approve-message').value,
        rejectMessage:document.getElementById('vf-reject-message').value
      });
      toast('Verification saved.');
    }catch(e){toast(e.message,true);}
  };
  document.getElementById('vf-post').onclick=async()=>{
    try{
      await sendJson('POST',`/api/guild/${currentGuild}/verification/panel`);
      toast('Verification panel posted.');
    }catch(e){toast(e.message,true);}
  };
}

/* NEXORA: one unsaved-changes popup instead of Save buttons on each page */
(function nxUnsaved(){
  const bar=document.getElementById('unsaved-bar');
  if(!bar)return;
  const isSaveBtn=b=>b.classList.contains('save-btn')||/save/i.test(b.id||'')||/^save/i.test((b.textContent||'').trim());
  const saveButtons=root=>[...root.querySelectorAll('button')].filter(isSaveBtn);
  let dirty=false;
  const show=()=>{dirty=true;bar.hidden=false;};
  const hide=()=>{dirty=false;bar.hidden=true;};
  const hideSaveButtons=()=>saveButtons(content).forEach(b=>{b.style.display='none';});
  new MutationObserver(hideSaveButtons).observe(content,{childList:true,subtree:true});
  const track=e=>{
    const t=e.target;
    if(!t||!t.matches||!t.matches('input,select,textarea'))return;
    const panel=t.closest('.panel');
    if(!panel||!saveButtons(panel).length)return;
    show();
  };
  content.addEventListener('input',track);
  content.addEventListener('change',track);
  document.getElementById('unsaved-cancel').onclick=()=>{hide();renderPage(activePage||'overview');};
  document.getElementById('unsaved-save').onclick=()=>{
    const btn=saveButtons(content)[0];
    hide();
    if(btn)btn.click();
  };
  window.nxDiscardCheck=()=>{
    if(!dirty)return true;
    if(confirm('Discard unsaved changes?')){hide();return true;}
    return false;
  };
  hideSaveButtons();
})();

/* NEXORA: scheduled announcements, each server in its own time zone */
async function renderAnnouncements(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading announcements…</p></div>';
  const d=await api(`/api/guild/${currentGuild}/announcements`);
  const tzOpts=d.timezones.map(z=>`<option value="${z}" ${z===d.timezone?'selected':''}>${z.replace(/_/g,' ')}</option>`).join('');
  const chanOpts=d.channels.map(ch=>`<option value="${ch.id}" ${ch.id===d.defaultChannelId?'selected':''}># ${escapeHtml(ch.name)}</option>`).join('');
  const rows=d.announcements.length?d.announcements.map(a=>{
    const when=a.nextRun?new Date(a.nextRun).toLocaleString('en-GB',{timeZone:d.timezone,dateStyle:'medium',timeStyle:'short'}):'—';
    const chan=d.channels.find(ch=>ch.id===a.channelId);
    return `<div class="rr-row"><div><b>${escapeHtml(a.title||'(no title)')}</b><div class="rw-sub">${chan?'# '+escapeHtml(chan.name):'Channel missing'} · ${a.repeat} · ${when} (${escapeHtml(d.timezone)}) · ${a.status}${a.lastError?' · '+escapeHtml(a.lastError):''}</div></div><button class="btn" data-ann-del="${a.id}">Delete</button></div>`;
  }).join(''):'<div class="rw-empty"><b>No announcements yet</b><span>Schedule one below.</span></div>';

  content.innerHTML=panel('Announcements','Each server has its own time zone. The bot posts at the time you pick, in that zone.',`
    <div class="set-group"><div class="set-title">SERVER TIME ZONE</div>
      <div class="field"><label>Time zone for this server</label><select id="ann-tz">${tzOpts}</select></div>
      <div class="rewards-actions"><button class="btn" id="ann-tz-apply">Use this time zone</button></div>
    </div>
    <div class="set-group"><div class="set-title">NEW ANNOUNCEMENT</div>
      <div class="field"><label>Channel</label><select id="ann-channel">${chanOpts}</select></div>
      <div class="field"><label>Title (optional)</label><input id="ann-title" class="rr-input" maxlength="256"></div>
      <div class="field"><label>Message</label><textarea id="ann-body" class="rr-input" rows="4" maxlength="2000"></textarea><small class="muted">Write --- on its own line to add a divider.</small></div>
      <div class="field"><label><input type="checkbox" id="ann-embed" checked> Send as an embed card</label></div>
      <div class="field"><label>Repeat</label><select id="ann-repeat"><option value="once">Once</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></div>
      <div class="field"><label>Date (first post, in ${escapeHtml(d.timezone)})</label><input type="date" id="ann-date" class="rr-input"></div>
      <div class="field"><label>Time (in ${escapeHtml(d.timezone)})</label><input type="time" id="ann-time" class="rr-input"></div>
      <div class="rewards-actions"><button class="btn primary" id="ann-create">Schedule announcement</button></div>
    </div>
    <div class="set-group"><div class="set-title">SCHEDULED</div>${rows}</div>
  `,false);

  const sendJson=async(method,path,body)=>{
    const res=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});
    const out=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(out.error||'Request failed');
    return out;
  };
  document.getElementById('ann-tz-apply').onclick=async()=>{
    try{
      await sendJson('PUT',`/api/guild/${currentGuild}/announcements/timezone`,{timezone:document.getElementById('ann-tz').value});
      toast('Time zone updated.');
      renderAnnouncements();
    }catch(e){toast(e.message,true);}
  };
  document.getElementById('ann-create').onclick=async()=>{
    try{
      await sendJson('POST',`/api/guild/${currentGuild}/announcements`,{
        channelId:document.getElementById('ann-channel').value,
        title:document.getElementById('ann-title').value,
        body:document.getElementById('ann-body').value,
        useEmbed:document.getElementById('ann-embed').checked,
        repeat:document.getElementById('ann-repeat').value,
        date:document.getElementById('ann-date').value,
        time:document.getElementById('ann-time').value
      });
      toast('Announcement scheduled.');
      renderAnnouncements();
    }catch(e){toast(e.message,true);}
  };
  content.querySelectorAll('[data-ann-del]').forEach(btn=>btn.onclick=async()=>{
    try{
      await sendJson('DELETE',`/api/guild/${currentGuild}/announcements/${btn.dataset.annDel}`);
      toast('Announcement deleted.');
      renderAnnouncements();
    }catch(e){toast(e.message,true);}
  });
}

/* ZERON: onboarding page (welcome card, steps, and roles members can pick) */
async function renderOnboarding(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading onboarding…</p></div>';
  const d=await api(`/api/guild/${currentGuild}/onboarding`);
  const c=d.config;
  const chanOpts='<option value="">— None —</option>'+d.channels.map(ch=>`<option value="${ch.id}" ${ch.id===c.channelId?'selected':''}># ${escapeHtml(ch.name)}</option>`).join('');
  const steps=[0,1,2,3,4].map(i=>{
    const st=c.steps[i]||{};
    return `<div class="field"><label>Step ${i+1} title${i>0?' (optional)':''}</label><input class="rr-input ob-title" maxlength="100" value="${escapeHtml(st.title||'')}"></div>
      <div class="field"><label>Step ${i+1} text</label><textarea class="rr-input ob-text" rows="2" maxlength="1000">${escapeHtml(st.text||'')}</textarea><small class="muted">Write --- on its own line to add a divider.</small></div>`;
  }).join('');
  const roleBoxes=d.roles.map(r=>`<label class="row"><input type="checkbox" class="ob-role" value="${r.id}" ${c.roles.includes(r.id)?'checked':''}> @ ${escapeHtml(r.name)}</label>`).join('')||'<div class="rw-sub">No roles yet.</div>';

  content.innerHTML=panel('Onboarding','New members get a welcome card with a button. They read the steps, then pick their roles.',`
    <div class="set-group"><div class="set-title">SETUP</div>
      ${toggle('Onboarding on','Post a welcome card for each new member.','ob_enabled',c.enabled)}
      <div class="field"><label>Onboarding channel</label><select id="ob-channel">${chanOpts}</select></div>
    </div>
    <div class="set-group"><div class="set-title">STEPS (up to 5)</div>${steps}</div>
    <div class="set-group"><div class="set-title">ROLES MEMBERS CAN PICK (up to 10)</div>${roleBoxes}</div>
    <div class="rewards-actions"><button class="btn primary" id="ob-save">Save onboarding</button></div>
  `,false);

  const sendJson=async(method,path,body)=>{
    const res=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});
    const out=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(out.error||'Request failed');
    return out;
  };
  document.getElementById('ob-save').onclick=async()=>{
    try{
      const titles=[...document.querySelectorAll('.ob-title')];
      const texts=[...document.querySelectorAll('.ob-text')];
      await sendJson('PUT',`/api/guild/${currentGuild}/onboarding`,{
        enabled:document.querySelector('input[name="ob_enabled"]').checked,
        channelId:document.getElementById('ob-channel').value,
        steps:titles.map((t,i)=>({title:t.value,text:texts[i].value})),
        roles:[...document.querySelectorAll('.ob-role:checked')].map(i=>i.value)
      });
      toast('Onboarding saved.');
    }catch(e){toast(e.message,true);}
  };
}

/* ZERON: stats channels page (voice channels renamed with live counts) */
async function renderStatsChannels(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading stats channels…</p></div>';
  const d=await api(`/api/guild/${currentGuild}/stats-channels`);
  const rows=[0,1,2].map(i=>{
    const item=d.items[i]||{};
    const opts='<option value="">— None —</option>'+d.voice.map(v=>`<option value="${v.id}" ${v.id===item.channel_id?'selected':''}>🔊 ${escapeHtml(v.name)}</option>`).join('');
    return `<div class="field"><label>Voice channel ${i+1}</label><select class="sc-channel">${opts}</select></div>
      <div class="field"><label>Name template</label><input class="rr-input sc-template" maxlength="60" placeholder="Members: {members}" value="${escapeHtml(item.template||'')}"></div>`;
  }).join('');
  content.innerHTML=panel('Stats channels','Voice channels are renamed every 10 minutes with live counts. Use {members} (total), {humans} (no bots), or {bots}.',`
    <div class="set-group"><div class="set-title">CHANNELS (up to 3)</div>${rows}</div>
    <div class="rewards-actions"><button class="btn primary" id="sc-save">Save stats channels</button></div>
  `,false);

  const sendJson=async(method,path,body)=>{
    const res=await fetch(path,{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});
    const out=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(out.error||'Request failed');
    return out;
  };
  document.getElementById('sc-save').onclick=async()=>{
    try{
      const channels=[...document.querySelectorAll('.sc-channel')];
      const templates=[...document.querySelectorAll('.sc-template')];
      const items=channels.map((c,i)=>({channelId:c.value,template:templates[i].value})).filter(i=>i.channelId||i.template.trim());
      await sendJson('PUT',`/api/guild/${currentGuild}/stats-channels`,{items});
      toast('Stats channels saved. Names update within 10 minutes.');
    }catch(e){toast(e.message,true);}
  };
}

/* ZERON: My rank card (one background per server, for each member) */
window.nxRankServer=window.nxRankServer||null;
async function renderMyRank(){
  content.innerHTML='<div class="panel card rw-card"><p class="rw-sub">Loading…</p></div>';
  const info=await api('/api/me/rank-backgrounds').catch(()=>null);
  if(!info){
    content.innerHTML=panel('My rank card','Sign in with Discord to choose your rank card background.','<p class="rw-sub">Use the Connect Discord button at the top, then come back here.</p>',false);
    return;
  }
  if(!info.servers.length){
    content.innerHTML=panel('My rank card','Backgrounds are set per server.','<p class="rw-sub">You are not in a server where ZERON is installed yet.</p>',false);
    return;
  }
  if(!info.servers.some(x=>x.id===window.nxRankServer)) window.nxRankServer=info.servers[0].id;
  const server=info.servers.find(x=>x.id===window.nxRankServer);
  const bg=server.background;
  const label=!bg?'Default':bg.kind==='preset'?((info.presets.find(x=>x.id===bg.preset)||{}).name||bg.preset):'Your upload';
  const serverButtons=info.servers.map(x=>`<button class="btn ${x.id===server.id?'primary':''}" data-rank-server="${x.id}">${escapeHtml(x.name)}</button>`).join(' ');
  const presetButtons=info.presets.map(x=>`<button class="btn ${bg&&bg.preset===x.id?'primary':''}" data-rank-preset="${x.id}">${escapeHtml(x.name)}</button>`).join(' ');
  const preview=bg?`<img src="/api/me/rank-background/${server.id}/image?t=${bg.updatedAt}" alt="Rank card background" style="width:100%;max-width:720px;border-radius:14px;border:1px solid #ffffff14">`:'<div class="rw-sub">Using the default background in this server.</div>';
  content.innerHTML=panel('My rank card','Each server has its own background for your /rank card. Pick a server, then choose a background for it.',`
    <div class="set-group"><div class="set-title">SERVER</div><div class="rewards-actions">${serverButtons}</div></div>
    <div class="set-group"><div class="set-title">CURRENT FOR ${escapeHtml(server.name).toUpperCase()}: ${escapeHtml(label)}</div>${preview}</div>
    <div class="set-group"><div class="set-title">BUILT-IN BACKGROUNDS</div><div class="rewards-actions">${presetButtons}</div></div>
    <div class="set-group"><div class="set-title">YOUR OWN IMAGE</div>
      <div class="field"><label>PNG or JPG, 2 MB max</label><input type="file" id="rank-file" accept="image/png,image/jpeg"></div>
      <div class="rewards-actions"><button class="btn primary" id="rank-upload">Upload background</button><button class="btn" id="rank-reset">Reset to default</button></div>
    </div>
  `,false);

  const send=async(method,path,body,type)=>{
    const res=await fetch(path,{method,credentials:'same-origin',headers:type?{'Content-Type':type}:{'Content-Type':'application/json'},body});
    const out=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(out.error||'Request failed');
    return out;
  };
  content.querySelectorAll('[data-rank-server]').forEach(btn=>btn.onclick=()=>{window.nxRankServer=btn.dataset.rankServer;renderMyRank();});
  content.querySelectorAll('[data-rank-preset]').forEach(btn=>btn.onclick=async()=>{
    try{
      await send('PUT',`/api/me/rank-background/${server.id}/preset`,JSON.stringify({preset:btn.dataset.rankPreset}));
      toast('Background updated for '+server.name+'.');
      renderMyRank();
    }catch(e){toast(e.message,true);}
  });
  document.getElementById('rank-upload').onclick=async()=>{
    const file=document.getElementById('rank-file').files[0];
    if(!file) return toast('Choose a PNG or JPG file first.',true);
    if(!['image/png','image/jpeg'].includes(file.type)) return toast('Use a PNG or JPG image.',true);
    if(file.size>2*1024*1024) return toast('The image must be 2 MB or smaller.',true);
    try{
      // Rank cards render at 1200x360. Normalize uploads in the browser so
      // oversized phone photos do not stall the PureImage worker while decoding.
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 360;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare this image. Please try another PNG or JPG.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === 'function') bitmap.close();
      const optimized = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!optimized) throw new Error('Could not optimize this image. Please try another PNG or JPG.');
      await send('PUT',`/api/me/rank-background/${server.id}/custom`,optimized,'image/jpeg');
      toast('Background optimized and saved for '+server.name+'.');
      renderMyRank();
    }catch(e){toast(e.message,true);}
  };
  document.getElementById('rank-reset').onclick=async()=>{
    try{
      await send('DELETE',`/api/me/rank-background/${server.id}`);
      toast('Back to the default background for '+server.name+'.');
      renderMyRank();
    }catch(e){toast(e.message,true);}
  };
}

/* ZERON: show the sidebar only after sign-in */
(async function nxSidebarAuth(){
  try{
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    const data = await r.json();
    document.body.classList.toggle('logged-out', !(data && data.user));
  }catch(e){
    document.body.classList.add('logged-out');
  }
})();

/* ZERON: logged-out visitors get a sign-in message instead of an empty menu */
document.addEventListener('click', function nxLoginNotice(e){
  if(!document.body.classList.contains('logged-out')) return;
  // Account-menu actions must remain clickable while logged out so users can start OAuth.
  if(e.target.closest('#account-menu [data-am="connect"], #account-menu [data-am="switch"], #account-menu [data-am="logout"]')) return;
  const trigger = e.target.closest('#menu-toggle, .top-actions button:not(#login-btn):not(#account-btn)');
  if(!trigger) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  toast('Log in with Discord first.', true);
}, true);

/* ZERON Phase 3: activity feed, search, and bottom tab bar */
function nxTimeAgo(ts){
  const t=Date.parse(String(ts||'').replace(' ','T')+'Z');
  if(!t) return '';
  const m=Math.round((Date.now()-t)/60000);
  if(m<1) return 'now';
  if(m<60) return m+'m';
  const h=Math.round(m/60);
  if(h<48) return h+'h';
  return Math.round(h/24)+'d';
}

async function loadOverviewFeed(){
  const box=document.getElementById('ov-feed');
  if(!box||!currentGuild) return;
  const data=await api(`/api/guild/${currentGuild}/logs`).catch(()=>null);
  const logs=((data&&data.logs)||[]).slice(0,6);
  if(!logs.length){ box.innerHTML='<p class="rw-sub">No moderation actions yet.</p>'; return; }
  box.innerHTML=logs.map(l=>`<div class="ov-feed-row"><span class="ov-feed-dot"></span><div><strong>${escapeHtml(String(l.action||'').replace(/_/g,' '))}</strong><small>${escapeHtml(l.reason||'No reason given')}</small></div><time>${nxTimeAgo(l.created_at)}</time></div>`).join('');
}

(function nxSearchSetup(){
  const input=document.getElementById('nx-search');
  const results=document.getElementById('nx-results');
  if(!input||!results) return;
  const pages=()=>Array.from(document.querySelectorAll('.sidebar [data-page]')).map(b=>({page:b.dataset.page,name:b.textContent.trim()}));
  const close=()=>{results.hidden=true;results.innerHTML='';};
  input.addEventListener('input',()=>{
    const q=input.value.trim().toLowerCase();
    if(!q){ close(); return; }
    const found=pages().filter(p=>p.name.toLowerCase().includes(q)).slice(0,8);
    results.innerHTML=found.length
      ? found.map(p=>`<button data-page="${p.page}">${escapeHtml(p.name)}</button>`).join('')
      : '<button disabled>No match</button>';
    results.hidden=false;
    results.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{
      input.value=''; close(); renderPage(b.dataset.page);
    });
  });
  document.addEventListener('click',e=>{ if(!e.target.closest('.nx-search')) close(); });
})();


/* ZERON Phase 3: page action strip on each system page */
(function nxPageStrip(){
  const baseRenderPage = renderPage;
  const syncApply = () => {
    const apply = document.getElementById('ps-apply');
    const bar = document.getElementById('unsaved-bar');
    if (apply && bar) apply.hidden = bar.hidden;
  };
  const addStrip = page => {
    const link = document.querySelector(`.sidebar [data-page="${page}"]`);
    const title = link ? link.textContent.trim() : '';
    const strip = document.createElement('div');
    strip.className = 'page-strip';
    strip.innerHTML = `<button type="button" class="btn" id="ps-back">← Overview</button>` +
      `<span class="page-strip-title">${escapeHtml(title)}</span>` +
      `<button type="button" class="btn primary" id="ps-apply" hidden>Apply changes</button>`;
    content.prepend(strip);
    strip.querySelector('#ps-back').onclick = () => renderPage('overview');
    strip.querySelector('#ps-apply').onclick = () => {
      const save = document.getElementById('unsaved-save');
      if (save) save.click();
    };
    syncApply();
  };
  const bar = document.getElementById('unsaved-bar');
  if (bar) new MutationObserver(syncApply).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  renderPage = async function(page){
    await baseRenderPage(page);
    // Let async page renderers finish inserting their fields before attaching previews.
    await new Promise(resolve=>requestAnimationFrame(resolve));
    attachDiscordPreviews();
    // Keep previews attached when async dashboard sections finish inserting fields.
    if (!content.dataset.discordPreviewObserver) {
      const previewObserver = new MutationObserver(() => attachDiscordPreviews());
      previewObserver.observe(content, { childList: true, subtree: true });
      content.dataset.discordPreviewObserver = '1';
    }
    if (window.nxSyncBottomTab) window.nxSyncBottomTab(page);
    nxOpenGroupFor(page);
    // Every button inside the page that should open another page now works, including the empty-state "Choose server" buttons.
    content.querySelectorAll('button').forEach(b => {
      if (/^choose server/i.test(b.textContent.trim()) && !b.dataset.page) b.dataset.page = 'servers';
    });
    content.querySelectorAll('[data-page]').forEach(b => {
      if (!b.onclick) b.onclick = () => renderPage(b.dataset.page);
    });
    if (page !== 'overview' && page !== 'my-rank' && currentGuild) addStrip(page);
  };
})();


/* ZERON: iOS-style bottom bar. Tap a tab, or hold a tab and slide left or right to pick one. The bar stays in place. */
(function nxBottomBar(){
  const bar=document.getElementById('bottom-bar');
  if(!bar) return;
  const track=bar.querySelector('.bar-track');
  const lens=document.getElementById('bar-lens');
  const tabs=[...track.querySelectorAll('[data-page]')];
  let timer=null, scrubbing=false, pickedTab=null, startX=0, startY=0, suppressClick=false;

  // The bar always sits at the bottom. Any saved position from older versions is cleared.
  bar.style.left=''; bar.style.top=''; bar.style.right=''; bar.style.bottom=''; bar.style.width='';
  try{ localStorage.removeItem('zeron-bottom-bar'); }catch(e){}

  const placeLens=(tab, instant)=>{
    if(!tab) return;
    const tr=track.getBoundingClientRect();
    const r=tab.getBoundingClientRect();
    lens.style.transition=instant?'none':'';
    lens.style.width=r.width+'px';
    lens.style.transform=`translateX(${r.left-tr.left}px)`;
  };
  const markActive=tab=>{
    tabs.forEach(t=>t.classList.toggle('active', t===tab));
    placeLens(tab,false);
  };
  const nearestTab=x=>{
    let best=null, bestDist=Infinity;
    tabs.forEach(t=>{
      const r=t.getBoundingClientRect();
      const d=Math.abs(r.left+r.width/2-x);
      if(d<bestDist){ bestDist=d; best=t; }
    });
    return best;
  };

  window.nxSyncBottomTab=page=>markActive(tabs.find(t=>t.dataset.page===page)||null);
  markActive(tabs.find(t=>t.dataset.page==='overview'));
  window.addEventListener('resize', ()=>{
    placeLens(tabs.find(t=>t.classList.contains('active')), true);
  });

  bar.addEventListener('pointerdown', e=>{
    const onTab=e.target.closest('[data-page]');
    if(!onTab) return;
    startX=e.clientX; startY=e.clientY;
    clearTimeout(timer);
    timer=setTimeout(()=>{
      scrubbing=true;
      pickedTab=onTab;
      bar.classList.add('scrubbing');
      placeLens(pickedTab,false);
      try{ bar.setPointerCapture(e.pointerId); }catch(_){}
      if(navigator.vibrate) navigator.vibrate(12);
    }, 220);
  });

  bar.addEventListener('pointermove', e=>{
    if(!scrubbing){
      if(timer && Math.abs(e.clientX-startX)>10){ clearTimeout(timer); timer=null; }
      return;
    }
    e.preventDefault();
    pickedTab=nearestTab(e.clientX);
    placeLens(pickedTab,false);
  });

  const finish=()=>{
    clearTimeout(timer); timer=null;
    if(scrubbing){
      scrubbing=false;
      bar.classList.remove('scrubbing');
      suppressClick=true; setTimeout(()=>{ suppressClick=false; }, 300);
      if(pickedTab){ markActive(pickedTab); renderPage(pickedTab.dataset.page); }
      else markActive(tabs.find(t=>t.classList.contains('active')));
      pickedTab=null;
    }
  };
  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);

  // A tap opens the tab. A hold-and-slide does not also trigger a tap.
  tabs.forEach(t=>t.addEventListener('click', e=>{
    if(suppressClick){ e.stopImmediatePropagation(); e.preventDefault(); return; }
    markActive(t);
    renderPage(t.dataset.page);
  }));
  bar.addEventListener('contextmenu', e=>e.preventDefault());
})();

/* ZERON: sidebar categories open and close like the server selector, and remember their state */
function nxSaveGroupState(){
  const collapsed=[...document.querySelectorAll('.side-group.collapsed')].map(g=>g.dataset.group);
  try{ localStorage.setItem('zeron-side-groups', JSON.stringify(collapsed)); }catch(e){}
}
function nxOpenGroupFor(page){
  const link=document.querySelector(`.sidebar [data-page="${page}"]`);
  const group=link&&link.closest('.side-group');
  if(group && group.classList.contains('collapsed')){
    group.classList.remove('collapsed');
    const t=group.querySelector('.side-toggle'); if(t) t.setAttribute('aria-expanded','true');
    nxSaveGroupState();
  }
}
(function nxSideGroups(){
  try{
    const collapsed=new Set(JSON.parse(localStorage.getItem('zeron-side-groups')||'[]'));
    document.querySelectorAll('.side-group').forEach(g=>{
      const on=collapsed.has(g.dataset.group);
      g.classList.toggle('collapsed', on);
      const t=g.querySelector('.side-toggle'); if(t) t.setAttribute('aria-expanded', String(!on));
    });
  }catch(e){}
  document.addEventListener('click', e=>{
    const t=e.target.closest('.side-toggle');
    if(!t) return;
    const g=t.closest('.side-group');
    const collapsed=g.classList.toggle('collapsed');
    t.setAttribute('aria-expanded', String(!collapsed));
    nxSaveGroupState();
  });
})();

/* ZERON: Jail page. The chosen role is what /jail gives. Only the server owner can run /jail and /unjail. */
async function renderJail(){
  const d=await api(`/api/guild/${currentGuild}/roles`);
  const current=(settings&&settings.jail_role_id)||'';
  const options='<option value="">— No jail role —</option>'+d.roles.map(r=>
    `<option value="${r.id}" ${r.id===current?'selected':''} ${r.managed?'disabled':''}>@ ${escapeHtml(r.name)}${r.managed?' (managed)':''}</option>`).join('');
  content.innerHTML=panel('Jail','Pick the role that /jail gives. /jail removes the member\'s other roles, and /unjail brings them back. Only the server owner can use these commands.',`
    <div class="set-group"><div class="set-title">JAIL ROLE</div>
      <div class="field"><label>Role given when a member is jailed</label><select id="jail-role">${options}</select></div>
      <div class="rewards-actions"><button class="btn primary" id="jail-save">Save jail role</button></div>
    </div>`,false);
  document.getElementById('jail-save').onclick=async()=>{
    try{
      const value=document.getElementById('jail-role').value;
      await api(`/api/guild/${currentGuild}/settings`,{method:'PUT',body:JSON.stringify({jail_role_id:value})});
      settings.jail_role_id=value;
      toast('Jail role saved.');
    }catch(e){ toast(e.message,true); }
  };
}
