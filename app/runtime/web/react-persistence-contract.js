// Trusted host/runtime limits. A profile declaration is not a persistence grant.
export const REACT_PERSISTENCE_PROFILE='react-persistent-preview-v1';
export const PERSISTENCE_LIMITS=Object.freeze({keys:32,valueBytes:65536,cacheBytes:262144,durableBytes:1048576,receipts:1000,queue:32,writesPerSecond:10,grantMs:300000});
export const PERSISTENCE_ADAPTER=Object.freeze({sourceApi:'localStorage_json_subset',previewBackend:'host_project_sqlite',nativeOriginStorage:false,exportedSourceBackend:'browser_localStorage',environmentParity:'not_established',functionalVerification:'not_established'});
