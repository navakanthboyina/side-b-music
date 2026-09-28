export const LANGUAGES=['Mixed','Telugu','Hindi','English','Tamil','Kannada','Malayalam','Punjabi','Bengali'];
export const languageName=value=>typeof value==='string'?LANGUAGES.find(x=>x.toLowerCase()===value.trim().toLowerCase()):undefined;
