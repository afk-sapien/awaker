// The sidebar count of pushes delivered since this browser last opened Notifications. The mark is
// kept per browser, so a first visit starts from now instead of counting the whole history as new.
const key='awaker-notifications-seen';
export function markSeen(at=Date.now()){try{localStorage.setItem(key,String(at))}catch{}}
export function unread(worker){
 let seen;try{seen=Number(localStorage.getItem(key))}catch{return 0}
 if(!seen){markSeen();return 0}
 return (worker?.outbox||[]).filter(o=>o.status==='accepted'&&o.acceptedAt>seen).length;
}
export const badge=count=>count?`<span class="nav-count" aria-label="${count} new">${count>99?'99+':count}</span>`:'';
