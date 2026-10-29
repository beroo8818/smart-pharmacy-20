import {computeContinuousAnalysis} from './continuousEngine';
self.onmessage=event=>{
  const {id,input}=event.data;
  try{self.postMessage({id,result:computeContinuousAnalysis(input)});}
  catch(error){self.postMessage({id,error:error instanceof Error?error.message:'تعذر حساب المخزون'});}
};
