// The team color picker.
import {themes,getTheme,applyTheme} from '../themes.js';
import {S} from './state.js';
import {$} from './core.js';

export function themePicker(){
 const theme=getTheme(S.themeId);
 $('#theme-team').innerHTML=themes.map(t=>`<option value="${t.id}" ${t.id===S.themeId?'selected':''}>${t.name}</option>`).join('');
 $('#theme-preview-name').textContent=theme.name;
 $('#theme-status').textContent='Colors apply instantly and save in this browser.';
}
export function selectTheme(id){
 S.themeId=applyTheme(id).id;
 $('#theme-preview-name').textContent=getTheme(S.themeId).name;
 $('#theme-team').value=S.themeId;
 let saved=true;try{localStorage.setItem('sunday-theme',S.themeId)}catch{saved=false}
 $('#theme-status').textContent=saved?'Theme saved in this browser.':'Theme applied. Browser storage is unavailable, so it will reset on reload.';
}
