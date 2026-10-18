// Apply the ordinary "All on map" fit once, independently of style loading.
export function createInitialMapFraming({fit}){
 let pending=true;
 return {
  update(ready,places){if(!pending||!ready||!places.length)return;pending=false;fit(places)},
  cancel(){pending=false}
 };
}
