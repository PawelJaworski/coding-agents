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
 *   "observes", "observes-cmd", "displays", "translates", "translates-cmd")
 *   identifying the semantic edge type — see kind meanings below.
 * - the outer container has class "wrap"
 * - a global EM_RENDER(visibleIds) that re-renders the table + SVG for the
 *   given visible card-id set (null = everything), re-flowing rows/columns
 *   so hidden cards leave NO gaps — provided by the page glue emitted by
 *   generate.js on top of the inlined scripts/layout.js (EMLayout) and the
 *   model JSON (EM_MODEL). Filtering HIDES cards entirely (they disappear
 *   from the diagram) instead of dimming them.
 * - CSS defines .card.active (focused) state and grab/grabbing cursors for
 *   .wrap, e.g.:
 *     .card.active{outline:3px solid #333;outline-offset:2px}
 *     .wrap{cursor:grab}
 *     .wrap.is-panning{cursor:grabbing}
 *
 * Edge kinds:
 *   triggers        UI card -> command (human trigger)
 *   produces        command -> event(s)
 *   observes        event -> read model (purple, no arrowhead)
 *   observes-cmd    event -> automated command (automation/robot step)
 *   displays        read model -> output UI
 *   translates      external event -> translator (Translation Pattern)
 *   translates-cmd  translator -> command (Translation Pattern)
 *
 * Click-to-focus highlights the clicked card plus its **one-hop**
 * neighbors in both directions:
 *   - upstream: cards that directly feed into the clicked card
 *   - downstream: cards that the clicked card directly feeds into
 *
 * **Cumulative filtering**: each new click **adds** its neighbors to the
 * visible set (union). Previously shown cards stay visible — they don't
 * disappear when you click a different card. Clicking the same card again
 * toggles *focus* off (clears `focused`) but the accumulated visible set
 * remains until the background is clicked.
 *
 * EM_RENDER re-renders the table and the SVG arrow overlay containing
 * only the visible cards, re-flowing rows and columns so no gaps remain
 * where hidden cards were.
 *
 * One hop means:
 *   - Read model → upstream: its subscribed events; downstream: its output UIs
 *   - Command → upstream: its trigger UIs; downstream: its produced events
 *   - Event → upstream: the producing command; downstream: subscribed read
 *     models and automated commands
 *   - UI → upstream: the command it triggers; downstream: none (UIs are
 *     terminal — no "displays" edge is walked from a clicked UI)
 *   - External event / Translator → downstream: the command(s) it produces
 *     (they are start-of-slice nodes)
 *   - Output UI → downstream: the read model it displays; upstream: none
 */
var EDGES=[];
document.querySelectorAll('[data-from]').forEach(function(l){
  EDGES.push([l.getAttribute('data-from'), l.getAttribute('data-to'), l.getAttribute('data-kind')]);
});
var focused=null;
var visible=null; // accumulated visible set (cumulative union of all clicks)
var wrap=document.querySelector('.wrap');
var pan=null;
var suppressBackgroundClick=false;
function connectedSet(startId){
  // One-hop neighbors: show the clicked card plus the cards directly
  // upstream (that feed into it) and directly downstream (that it feeds
  // into). Everything beyond one hop is hidden.
  var visible={};
  visible[startId]=true;

  // Downstream: edges where startId is the source (startId -> X)
  EDGES.forEach(function(e){
    if(e[0]===startId && !visible[e[1]]){
      visible[e[1]]=true;
    }
  });

  // Upstream: edges where startId is the target (X -> startId)
  EDGES.forEach(function(e){
    if(e[1]===startId && !visible[e[0]]){
      visible[e[0]]=true;
    }
  });

  return visible;
}
function refresh(){
  // The visible set is the union of all previously clicked cards'
  // one-hop neighbors (accumulated across clicks).  When focused is null
  // the user sees everything; when focused is set we merge its neighbors
  // into the accumulated set so previously shown cards stay visible.
  var set = focused
    ? Object.assign(visible || {}, connectedSet(focused))
    : null;
  EM_RENDER(set);
  document.querySelectorAll('.card').forEach(function(c){
    c.classList.toggle('active', c.getAttribute('data-element')===focused);
  });
}
// Event delegation on .wrap — re-rendering (EM_RENDER) replaces the card
// nodes on every filter change, so per-node listeners would be lost. A GWT
// badge click wins over its hosting card (it must not toggle the focus).
wrap.addEventListener('click',function(e){
  var badge=e.target.closest && e.target.closest('.gwt-badge');
  if(badge){
    e.stopPropagation();
    showGwtModal(badge.getAttribute('data-gwt'));
    return;
  }
  var card=e.target.closest && e.target.closest('.card');
  if(card){
    e.stopPropagation();
    var id=card.getAttribute('data-element');
    focused = id;
    // On first click (or after background clear), seed the
    // accumulated visible set with this card's neighbors.
    if(!visible) visible = connectedSet(id);
    else Object.assign(visible, connectedSet(id));
    refresh();
    return;
  }
  // Background click clears the focus (a completed drag already suppressed it).
  if(suppressBackgroundClick){
    suppressBackgroundClick=false;
    return;
  }
  focused=null; visible=null; refresh();
});
wrap.addEventListener('pointerdown',function(e){
  if(e.button!==0 || e.target.closest('.card,.gwt-modal-content,button,a,input,textarea,select')) return;
  pan={pointerId:e.pointerId,x:e.clientX,y:e.clientY,distance:0};
  wrap.classList.add('is-panning');
  if(wrap.setPointerCapture) wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove',function(e){
  if(!pan || e.pointerId!==pan.pointerId) return;
  var dx=e.clientX-pan.x,dy=e.clientY-pan.y;
  pan.x=e.clientX;pan.y=e.clientY;
  pan.distance+=Math.abs(dx)+Math.abs(dy);
  if(pan.distance>3){
    window.scrollBy(-dx,-dy);
    e.preventDefault();
  }
});
function finishPan(e){
  if(!pan || e.pointerId!==pan.pointerId) return;
  suppressBackgroundClick=pan.distance>3;
  pan=null;
  wrap.classList.remove('is-panning');
  if(wrap.releasePointerCapture && wrap.hasPointerCapture && wrap.hasPointerCapture(e.pointerId)){
    wrap.releasePointerCapture(e.pointerId);
  }
}
wrap.addEventListener('pointerup',finishPan);
wrap.addEventListener('pointercancel',function(e){
  if(!pan || e.pointerId!==pan.pointerId) return;
  pan=null;
  suppressBackgroundClick=false;
  wrap.classList.remove('is-panning');
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

// GWT badge clicks are handled by the delegated .wrap click listener above
// (per-node binding would be lost whenever EM_RENDER re-renders the cards).

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
