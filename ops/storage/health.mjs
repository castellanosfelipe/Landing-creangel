try {
  const [port,route]=process.argv.slice(2);
  const response=await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.timeout(3000)});
  if(!response.ok)process.exit(1);
}catch{process.exit(1);}
