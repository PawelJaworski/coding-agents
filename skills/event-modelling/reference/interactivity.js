/*
 * Fixed interactivity template for Event Modeling diagrams.
 * Copy this block byte-identical into the diagram's <script> tag.
 * Do not adapt or rewrite it per-diagram — only the table/svg markup
 * around it changes with the inputs.
 *
 * Requires:
 * - every card element has class "card" and attribute data-element="<id>"
 * - every arrow element (line/polyline) has data-from="<id>" data-to="<id>",
 *   and optionally data-kind="<kind>" (one of "triggers", "produces",
 *   "observes", "observes-cmd", "displays") identifying the semantic edge
 *   type — see kind meanings below.
 * - the outer container has class "wrap"
 * - CSS defines .card.dim (dimmed) and .card.active (focused) states,
 *   plus a dim rule for arrows, e.g.:
 *     .card.dim{opacity:.12}
 *     .card.active{outline:3px solid #333;outline-offset:2px}
 *     svg [data-from].dim{opacity:.08}
 *
 * Click-to-focus filter is UPSTREAM-ONLY: clicking a card highlights the
 * card itself plus everything that causally led to it (walking data-from
 * backwards from data-to along "triggers"/"produces"/"observes"/
 * "observes-cmd" edges), i.e. its ancestors, never its descendants/
 * downstream siblings.
 *
 * UI cards are treated as TERMINAL ancestors: a UI is included in the
 * upstream set (via the "triggers" edge from that UI to the command it
 * triggers), but traversal does NOT continue backward past a UI through
 * its "displays" edge (read-model -> UI, i.e. "this UI happens to show
 * that read model"). Which read model a UI displays is a separate,
 * unrelated causal chain from what command that UI triggers, so walking
 * backward through "displays" would incorrectly pull in an unconnected
 * upstream slice. Concretely: clicking a read model highlights the event
 * that produced it, the command that produced that event, and the UI
 * card(s) that trigger that command — but not whatever read model those
 * UI cards happen to display.
 */
var EDGES=[];
document.querySelectorAll('[data-from]').forEach(function(l){
  EDGES.push([l.getAttribute('data-from'), l.getAttribute('data-to'), l.getAttribute('data-kind')]);
});
var focused=null;
function connectedSet(startId){
  // Upstream-only: walk backwards along data-from -> data-to edges,
  // i.e. from startId to whatever produced it (ancestors), never forwards
  // to what it produces (descendants). UI cards are included as ancestors
  // (via their "triggers" edge into a command) but are treated as a
  // stopping point: we do not continue backward through a "displays"
  // edge (read-model -> UI) into whatever read model feeds that UI, since
  // that belongs to a separate causal chain.
  var seen={}; seen[startId]=true;
  var queue=[startId];
  while(queue.length){
    var id=queue.shift();
    EDGES.forEach(function(e){
      if(e[1]===id && e[2]==='displays') return; // don't walk past a UI's Displays edge
      if(e[1]===id && !seen[e[0]]){seen[e[0]]=true;queue.push(e[0]);}
    });
  }
  return seen;
}
function refresh(){
  var set = focused ? connectedSet(focused) : null;
  document.querySelectorAll('.card').forEach(function(c){
    var id=c.getAttribute('data-element');
    c.classList.toggle('active', id===focused);
    c.classList.toggle('dim', !!set && !set[id]);
  });
  document.querySelectorAll('[data-from]').forEach(function(l){
    var from=l.getAttribute('data-from'), to=l.getAttribute('data-to');
    var visible = !set || (set[from] && set[to]);
    l.classList.toggle('dim', !visible);
  });
}
document.querySelectorAll('.card').forEach(function(c){
  c.addEventListener('click',function(e){
    e.stopPropagation();
    var id=c.getAttribute('data-element');
    focused = (focused===id) ? null : id;
    refresh();
  });
});
document.querySelector('.wrap').addEventListener('click',function(){
  focused=null; refresh();
});
refresh();

// GWT Modal functionality
function showGwtModal(readmodelId) {
  var gwtData = window.GWT_DATA && window.GWT_DATA[readmodelId];
  if (!gwtData) return;
  
  var modal = document.getElementById('gwt-modal');
  var title = document.getElementById('gwt-modal-title');
  var body = document.getElementById('gwt-modal-body');
  
  title.textContent = gwtData.title;
  
  var html = '';
  gwtData.scenarios.forEach(function(scenario) {
    html += '<div class="gwt-scenario">';
    html += '<div class="gwt-scenario-title">' + escapeHtmlHtml(scenario.name) + '</div>';
    
    if (scenario.given.length) {
      html += '<div class="gwt-section">';
      html += '<div class="gwt-section-title">Given</div>';
      html += '<div class="gwt-section-content"><ul>';
      scenario.given.forEach(function(item) {
        html += '<li>' + escapeHtmlHtml(item) + '</li>';
      });
      html += '</ul></div></div>';
    }
    
    if (scenario.when.length) {
      html += '<div class="gwt-section">';
      html += '<div class="gwt-section-title">When</div>';
      html += '<div class="gwt-section-content"><ul>';
      scenario.when.forEach(function(item) {
        html += '<li>' + escapeHtmlHtml(item) + '</li>';
      });
      html += '</ul></div></div>';
    }
    
    if (scenario.then.length) {
      html += '<div class="gwt-section">';
      html += '<div class="gwt-section-title">Then</div>';
      html += '<div class="gwt-section-content"><ul>';
      scenario.then.forEach(function(item) {
        html += '<li>' + escapeHtmlHtml(item) + '</li>';
      });
      html += '</ul></div></div>';
    }
    
    html += '</div>';
  });
  
  body.innerHTML = html;
  modal.classList.add('active');
}

function hideGwtModal() {
  var modal = document.getElementById('gwt-modal');
  modal.classList.remove('active');
}

function escapeHtmlHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Attach GWT badge click handlers
document.querySelectorAll('.gwt-badge').forEach(function(badge) {
  badge.addEventListener('click', function(e) {
    e.stopPropagation();
    var readmodelId = badge.getAttribute('data-gwt');
    showGwtModal(readmodelId);
  });
});

// Close modal on close button click
document.getElementById('gwt-modal-close').addEventListener('click', function() {
  hideGwtModal();
});

// Close modal on backdrop click
document.getElementById('gwt-modal').addEventListener('click', function(e) {
  if (e.target === this) {
    hideGwtModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    hideGwtModal();
  }
});
