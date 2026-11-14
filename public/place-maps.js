export function googleMapsUrl({name, address, lat, lon}) {
 const streetAddress = address?.trim();
 const isCoordinateAddress = /^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(streetAddress);
 const query = streetAddress && !isCoordinateAddress ? name + ' ' + streetAddress : lat + ',' + lon;
 const url = new URL('https://www.google.com/maps/search/');
 url.searchParams.set('api', '1');
 url.searchParams.set('query', query);
 return url.href;
}
