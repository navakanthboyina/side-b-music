export const LANGUAGES=['Mixed','Telugu','Hindi','English','Tamil','Kannada','Malayalam','Punjabi','Bengali'];
export const languageName=value=>typeof value==='string'?LANGUAGES.find(x=>x.toLowerCase()===value.trim().toLowerCase()):undefined;
export function languageSelection(value){
 const values=Array.isArray(value)?value:[value??'Mixed'];
 if(!values.length||values.length>LANGUAGES.length)return undefined;
 const names=values.map(languageName);if(names.some(x=>!x))return undefined;
 if(names.includes('Mixed'))return names.length===1?'Mixed':undefined;
 return LANGUAGES.filter(x=>names.includes(x)).join(' + ');
}
export const selectedLanguages=value=>String(value||'Mixed').split(' + ');
