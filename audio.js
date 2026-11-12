// Original procedural soundscape: Web Audio only, no downloaded music or tracking.
export function createAudio(){
  let context=null,master=null,sea=null,wind=null,slide=null,enabled=false,volume=.45,disposed=false,paused=false;
  let musicClock=4,stepClock=0,previousStage=-1;
  const voices=new Set(),lastCue=new Map();
  function envelope(param,target,time=.12){if(context&&param)param.setTargetAtTime(target,context.currentTime,time);}
  function voice(freq,start,duration=.2,gain=.07,type='sine',endFreq=null){
    if(!context||!master||disposed)return;
    const oscillator=context.createOscillator(),amp=context.createGain();
    oscillator.type=type;oscillator.frequency.setValueAtTime(freq,start);
    if(endFreq)oscillator.frequency.exponentialRampToValueAtTime(Math.max(25,endFreq),start+duration);
    amp.gain.setValueAtTime(0,start);amp.gain.linearRampToValueAtTime(gain,start+.018);amp.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(amp);amp.connect(master);voices.add(oscillator);
    oscillator.onended=()=>{oscillator.disconnect();amp.disconnect();voices.delete(oscillator);};
    oscillator.start(start);oscillator.stop(start+duration+.03);
  }
  function noise(filterType,frequency){
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    const buffer=context.createBuffer(1,context.sampleRate*3,context.sampleRate),samples=buffer.getChannelData(0);
    let smoothed=0;for(let i=0;i<samples.length;i++){smoothed=(smoothed+Math.random()*.04-.02)/1.025;samples[i]=smoothed*7;}
    source.buffer=buffer;source.loop=true;filter.type=filterType;filter.frequency.value=frequency;filter.Q.value=.25;gain.gain.value=0;
    source.connect(filter);filter.connect(gain);gain.connect(master);source.start();
    return {source,filter,gain};
  }
  async function unlock(){
    if(disposed)return false;
    try{
      if(!context){
        const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AudioContext)return false;
        context=new AudioContext();master=context.createGain();master.gain.value=0;master.connect(context.destination);
        sea=noise('lowpass',550);wind=noise('bandpass',320);slide=noise('highpass',950);
      }
      if(context.state==='suspended')await context.resume();
      envelope(master.gain,enabled&&!paused?volume:0,.06);
      return context.state==='running';
    }catch{
      // A denied or incomplete initialization must remain silent and non-fatal.
      if(!sea||!wind||!slide){try{context?.close()?.catch(()=>{});}catch{}context=master=sea=wind=slide=null;}
      return false;
    }
  }
  function cue(name){
    if(!context||!enabled||paused||disposed||context.state!=='running')return;
    const now=context.currentTime,minGap=name==='oil'?2:name==='fish'?.09:.15;
    if(now-(lastCue.get(name)??-100)<minGap)return;lastCue.set(name,now);
    const notes={
      fish:[[660,0,.16,.09],[990,.09,.24,.05]],
      eat:[[280,0,.11,.06],[420,.09,.18,.05]],
      oil:[[170,0,.28,.065],[145,.16,.3,.055]],
      snag:[[250,0,.18,.052],[156,.11,.24,.05]],
      release:[[392,0,.12,.046],[587,.10,.23,.045]],
      landing:[[440,0,.14,.045],[554,.12,.23,.04]],
      gust:[[132,0,.36,.026],[196,.23,.42,.02]],
      rescue:[[392,0,.28,.06],[523,.2,.28,.06],[659,.4,.5,.06]],
      signal:[[523,0,.16,.07],[784,.18,.24,.07],[523,.45,.4,.04]],
      stage:[[330,0,.5,.04],[440,.25,.6,.04]],
      win:[[392,0,.35,.07],[494,.22,.35,.07],[587,.44,.4,.07],[784,.7,1,.065]],
      lose:[[294,0,.6,.05],[247,.4,.65,.04],[196,.8,.8,.035]],
      ui:[[520,0,.09,.035]],
    }[name]||[[440,0,.12,.035]];
    if(name==='splash'){
      voice(235,now,.16,.022,'sine',74);
    }else if(name==='celebrate'){
      voice(840,now,.16,.043,'triangle',1090);
      voice(965,now+.16,.16,.035,'triangle',1270);
      voice(752,now+.39,.18,.039,'triangle',1025);
      voice(910,now+.58,.22,.037,'triangle',1120);
    }else for(const [frequency,offset,duration,level] of notes)voice(frequency,now+offset,duration,level,'sine');
  }
  return {
    unlock,
    setEnabled(value){enabled=Boolean(value);envelope(master?.gain,enabled&&!paused?volume:0,.07);},
    setVolume(value){if(Number.isFinite(value))volume=Math.max(0,Math.min(1,value));envelope(master?.gain,enabled&&!paused?volume:0,.07);},
    update(state={},dt=0){
      paused=Boolean(state.paused);if(!context||disposed)return;
      envelope(master.gain,enabled&&!paused?volume:0,.08);
      if(paused||!enabled)return;
      dt=Math.min(.25,Math.max(0,Number.isFinite(dt)?dt:0));
      const stage=state.stage||0,storm=Math.max(0,Math.min(1,state.wind||0)),inWater=state.terrain==='water';
      envelope(sea.gain.gain,state.preview ? .022 : inWater ? .065 : stage===4 ? .012 : .03,.6);
      envelope(wind.gain.gain,.012+storm*.095+(stage===4 ? .018 : 0),.5);
      envelope(wind.filter.frequency,260+storm*650,.6);
      envelope(slide.gain.gain,state.slide&&state.moving ? .055 : 0,.1);
      stepClock+=dt;
      if(state.moving&&!state.slide&&!inWater&&stepClock>.3){stepClock=0;voice(100+Math.random()*20,context.currentTime,.07,.012,'sine',60);}
      if(stage!==previousStage){previousStage=stage;musicClock=Math.min(musicClock,2);}
      musicClock-=dt;
      if(musicClock<=0){
        musicClock=state.preview?9:stage===2?12:10;
        const chords=[[220,277.18,329.63],[261.63,329.63,392],[196,233.08,293.66],[220,293.66,349.23],[246.94,293.66,369.99]];
        const notes=chords[Math.min(4,Math.max(0,stage))];
        notes.forEach((frequency,i)=>voice(frequency,context.currentTime+i*.65,1.8,.015,'triangle'));
      }
    },
    cue,
    dispose(){
      if(disposed)return;disposed=true;
      for(const channel of [sea,wind,slide]){try{channel?.source.stop();channel?.source.disconnect();channel?.filter.disconnect();channel?.gain.disconnect();}catch{}}
      for(const source of voices){try{source.stop();}catch{}}voices.clear();
      try{master?.disconnect();context?.close()?.catch(()=>{});}catch{}
      context=master=sea=wind=slide=null;
    },
  };
}
