/** Reviewed public capabilities; hackathon credit balance is never inferred here. */
export const BASETEN_MODEL='meta-models/muse-spark-open-1026';
export const PROVIDERS=Object.freeze({
 nebius:Object.freeze({id:'nebius',label:'Nebius',model:'nvidia/Nemotron-3_5-Lightning',origin:'https://api.tokenfactory.nebius.com',inputPrice:'0.06',outputPrice:'0.24',context:'1048576',thinking:'disabled',jsonMode:'json_object'}),
 baseten:Object.freeze({id:'baseten',label:'Baseten',model:BASETEN_MODEL,origin:'https://inference.baseten.co',inputPrice:'1.25',outputPrice:'4.25',context:'1048576',thinking:'provider_default',jsonMode:'prompt_only',reasoningEffort:'low',pricingBasis:'public Muse Spark Open rates; hackathon alias billing unverified'})
});
export function providerProfile(id='nebius'){if(!Object.hasOwn(PROVIDERS,id))throw Error('Unsupported provider');return PROVIDERS[id];}
