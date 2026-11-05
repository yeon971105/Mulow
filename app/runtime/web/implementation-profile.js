// A declared authoring format, not runtime authority or verified Goal completion.
const limitations=Object.freeze(['no_generated_code','no_external_services','no_multi_user','no_realtime','no_deployment','no_migrations','no_custom_interactions','no_filter_sort','no_schema_changes']);
export const TRUSTED_CRUD_IMPLEMENTATION_PROFILE=Object.freeze({id:'trusted-declarative-crud-v1',scope:'local_single_user',sourceKind:'declarative_schema',runtime:'trusted_host_sqlite',limitations});
export function validateImplementationProfile(value){
 const expected=TRUSTED_CRUD_IMPLEMENTATION_PROFILE;
 const fail=()=>{throw Object.assign(Error('implementation_profile_invalid'),{code:'implementation_profile_invalid'});};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).length!==Object.keys(expected).length||Object.keys(value).some(k=>!Object.hasOwn(expected,k)))fail();
 for(const key of ['id','scope','sourceKind','runtime'])if(value[key]!==expected[key])fail();
 if(!Array.isArray(value.limitations)||value.limitations.length!==limitations.length||value.limitations.some((v,i)=>v!==limitations[i]))fail();
 return {...expected,limitations:[...limitations]};
}
export function implementationProfileFields(value,previous={}){
 const source=Object.hasOwn(value||{},'implementationProfile')?value:previous;
 return Object.hasOwn(source||{},'implementationProfile')?{implementationProfile:validateImplementationProfile(source.implementationProfile)}:{};
}
