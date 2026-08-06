/*
 * Fixed interactivity template for Event Modeling diagrams.
 * Copy this block byte-identical into the diagram's <script> tag.
 * Do not adapt or rewrite it per-diagram — only the table/svg markup
 * around it changes with the inputs.
 *
 * Requires:
 * - every card element has class "card" and attribute data-element="<id>"
 * - every arrow element (line/polyline) has data-from="<id>" data-to="<id>"
 * - the outer container has class "wrap"
 * - CSS defines .card.dim (dimmed) and .card.active (focused) states,
 *   plus a dim rule for arrows, e.g.:
 *     .card.dim{opacity:.12}
 *     .card.active{outline:3px solid #333;outline-offset:2px}
 *     svg [data-from].dim{opacity:.08}
 */
var EDGES=[];
document.querySelectorAll('[data-from]').forEach(function(l){
  EDGES.push([l.getAttribute('data-from'), l.getAttribute('data-to')]);
});
var focused=null;
function connectedSet(startId){
  var seen={}; seen[startId]=true;
  var queue=[startId];
  while(queue.length){
    var id=queue.shift();
    EDGES.forEach(function(e){
      if(e[0]===id && !seen[e[1]]){seen[e[1]]=true;queue.push(e[1]);}
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
