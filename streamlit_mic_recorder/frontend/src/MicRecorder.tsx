import React from 'react';
import { StreamlitComponentBase, Streamlit, withStreamlitConnection } from 'streamlit-component-lib';
import toWav from 'audiobuffer-to-wav';
import './styles.css';
import tinycolor from 'tinycolor2'

interface State {
    recording: boolean;
    isHovered: boolean;
}

class MicRecorder extends StreamlitComponentBase<State> {

    private mediaRecorder?: MediaRecorder;
    private audioChunks: Blob[] = [];
    private output?:object;
    private srcStream?: MediaStream;                // raw mic
    private monoStream?: MediaStream;               // graph output (mono)
    private audioCtx?: AudioContext;                // web audio context
    private stopGraph?: () => void;                 // teardown helper
    public state: State = {
        recording: false,
        isHovered: false,
    };

    private handleMouseEnter = () => {
        this.setState({ isHovered: true });
    }
    
    private handleMouseLeave = () => {
        this.setState({ isHovered: false });
    }

    public componentDidMount(): void {
        super.componentDidMount()
        ///console.log("Component mounted")
    }

    private buttonStyle = (Theme:any):React.CSSProperties => {
        const baseBorderColor = tinycolor.mix(Theme.textColor, Theme.backgroundColor, 80).lighten(2).toString();
        const backgroundColor = tinycolor.mix(Theme.textColor, tinycolor.mix(Theme.primaryColor, Theme.backgroundColor, 99), 99).lighten(0.5).toString();
        const textColor = this.state.isHovered ? Theme.primaryColor : Theme.textColor;
        const borderColor = this.state.isHovered ? Theme.primaryColor : baseBorderColor;
        
        return {
            ...this.props.args["use_container_width"] ? { width: '100%' } : {},
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            color: textColor
        };
    }

    private onClick =()=>{
        this.state.recording ? (
            this.stopRecording()
        ):(
            this.startRecording()
        )
    }

    private buttonPrompt=()=>{
        return (
        this.state.recording ? (
            this.props.args["stop_prompt"]
        ):(
            this.props.args["start_prompt"]
        )
        )
    }

    public render(): React.ReactNode {
        //console.log("Component renders");
        const Theme = this.props.theme ?? {
            base: 'dark',
            backgroundColor: 'black',
            secondaryBackgroundColor: 'grey',
            primaryColor: 'red',
            textColor: 'white'
        };
        return (
            <div className="App">
                <button 
                    className="myButton" 
                    style={this.buttonStyle(Theme)} 
                    onClick={this.onClick}
                    onMouseEnter={this.handleMouseEnter}
                    onMouseLeave={this.handleMouseLeave}
                >
                    {this.buttonPrompt()}
                </button>
            </div>
        );
    }
    private getPreferredMimeType = (format: string | undefined): string | undefined => {
        if (format === 'wav') {
            return undefined;
        }
        if (format === 'webm') {
            const candidates = [
                'audio/webm;codecs=opus',
                'audio/webm'
            ];
            return candidates.find(MediaRecorder.isTypeSupported);
        }
        if (format === 'aac') {
            const candidates = [
                'audio/mp4;codecs=mp4a.40.2',
                'audio/mp4;codecs=aac',
                'audio/mp4',
                'audio/aac'
            ];
            return candidates.find(MediaRecorder.isTypeSupported);
        }
        return undefined;
    }

    private getBlobTypeForFormat = (format: string | undefined, recorderMime?: string): string => {
        return recorderMime || (format === 'aac' ? 'audio/mp4' : 'audio/webm');
    }

    private startRecording = () => {
        //console.log("Component starts recording");

        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(async (stream) => {
            this.srcStream = stream;

            // 2) Build Web Audio graph: L/R -> sum -> mono -> MediaStream destination
            const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
            this.audioCtx = new Ctor({ sampleRate: 48000 }); // 48k plays best with Opus, fine for AAC/WAV
            const ctx = this.audioCtx!;
            if (ctx.state === "suspended") {
                await ctx.resume();
            }
 
            // --- Replace existing graph wiring with this block ---

            const source = ctx.createMediaStreamSource(stream);

            // create destination and lock to mono
            const dest = new MediaStreamAudioDestinationNode(ctx);
            (dest as any).channelCount = 1;
            (dest as any).channelCountMode = 'explicit';
            (dest as any).channelInterpretation = 'speakers';

            // check what the UA reports for channel count
            const track = stream.getAudioTracks()[0];
            const settings = (track.getSettings?.() ?? {}) as any;
            const reportedCh = typeof settings.channelCount === 'number' ? settings.channelCount : 2;
            // If the browser actually returned mono, passthrough at unity gain.
            if (reportedCh === 1) {
              // simple pass-through; destination will be mono
              source.connect(dest);
            } else {
              // Stereo reported: use left channel only as the signal
              const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
              const leftGain = new GainNode(ctx, { gain: 1.0 }); // unity on left
              // wire left channel into dest
              source.connect(splitter);
              splitter.connect(leftGain, 0);         // left -> leftGain
              leftGain.connect(dest);                // leftGain -> mono dest

              // Save these nodes for teardown in stopGraph()
              // e.g. add splitter, leftGain to closure-scope variables or capture them some other way
              // so stopGraph() can disconnect them (see below).
              (this as any)._splitter = splitter;
              (this as any)._leftGain = leftGain;
            }

            // store dest stream as the one to record
            this.monoStream = dest.stream;

            // Teardown helper
            this.stopGraph = () => {
                try { source.disconnect(); } catch {}
                if ((this as any)._splitter) {
                    try { (this as any)._splitter.disconnect(); } catch {}
                    (this as any)._splitter = undefined;
                }
                if ((this as any)._leftGain) {
                    try { (this as any)._leftGain.disconnect(); } catch {}
                    (this as any)._leftGain = undefined;
                }
                try { dest.disconnect(); } catch {}
                if (this.srcStream) {
                    this.srcStream.getTracks().forEach(t => t.stop());
                }
                if (this.audioCtx && this.audioCtx.state !== 'closed') {
                    this.audioCtx.close();
                }
                this.srcStream = undefined;
                this.monoStream = undefined;
                this.audioCtx = undefined;
            };

            // 3) Record the MONO graph output
            const recordStream = this.monoStream!;
            const requestedFormat = this.props.args['format'];
            const preferredMime = this.getPreferredMimeType(requestedFormat);
            try {
                this.audioChunks = [];
                this.mediaRecorder = preferredMime ? new MediaRecorder(recordStream, { mimeType: preferredMime, audioBitsPerSecond:192_000, bitsPerSecond:192_000 }) : new MediaRecorder(recordStream);
            } catch (e) {
                // Fallback to browser default if our preferred type isn't constructible.
                this.mediaRecorder = new MediaRecorder(recordStream);
            }

            this.mediaRecorder.ondataavailable = event => {
                if (event.data) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onerror = (event) => {
                console.error("MediaRecorder error: ", event);
            };

            this.mediaRecorder.onstop = this.processAndSendRecording;

            this.mediaRecorder.start(1000);

            this.setState({ recording: true });
        }).catch(error => {
            console.error("Error initializing media recording: ", error);
        });
    };

    private stopRecording = async () => {
        const mr = this.mediaRecorder;
        if (mr && mr.state === 'recording') {
            //console.log("Component stops recording");
            mr.stop();
            this.setState({ recording: false });   
        }
    };

    private mimeToFormat = (mime?: string): 'webm' | 'aac' | 'wav' => {
        if (!mime) return 'webm';
        return mime.includes('mp4') || mime.includes('aac')
            ? 'aac'
            : mime.includes('webm')
            ? 'webm'
            : 'webm';
    };

    private processRecording = async () => {
        return new Promise<void>(async (resolve) => {
            const requestedFormat = this.props.args['format'] as 'webm' | 'wav' | 'aac' | undefined;

            const blobType = this.getBlobTypeForFormat(requestedFormat, this.mediaRecorder?.mimeType);
            const audioBlob = new Blob(this.audioChunks, { type: blobType });

            // prefer the live graph's sampleRate; fall back to 48k
            const sampleRateFromCtx = this.audioCtx?.sampleRate ?? 48000;

            // WAV path: decode -> PCM -> toWav -> base64
            if (requestedFormat === 'wav') {
                const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const arr = await audioBlob.arrayBuffer();
                let buf: AudioBuffer;
                try {
                    buf = await decodeCtx.decodeAudioData(arr);
                } catch (err) {
                    await decodeCtx.close();
                    console.error('decodeAudioData failed:', err);
                    // Fallback: return the original blob base64
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64String = reader.result?.toString().split(',')[1];
                        const actualMime = this.mediaRecorder?.mimeType || blobType;
                        const finalFormat = this.mimeToFormat(actualMime);
                        this.output = {
                            id: Date.now(),
                            format: finalFormat,
                            ...(finalFormat === 'aac' ? { container: actualMime } : {}),
                            audio_base64: base64String,
                            sample_rate: sampleRateFromCtx,
                            sample_width: 2,
                        };

                        resolve();
                    };
                    reader.readAsDataURL(audioBlob);
                    return;
                }

                // Encode to WAV from decoded PCM buffer
                const wav: ArrayBuffer = toWav(buf);
                await decodeCtx.close();

                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64String = reader.result?.toString().split(',')[1];
                    this.output = {
                        id: Date.now(),
                        format: 'wav',
                        audio_base64: base64String,
                        sample_rate: buf.sampleRate, // actual decoded rate
                        sample_width: 4,
                    };
                    resolve();
                };
                reader.readAsDataURL(new Blob([wav], { type: 'audio/wav' }));
                return;
            }
            // WebM / AAC path: no decode, just base64 the blob (derive format from actual MIME)
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64String = reader.result?.toString().split(",")[1];
              const actualMime = this.mediaRecorder?.mimeType || blobType;
              const finalFormat = this.mimeToFormat(actualMime);

              this.output = {
                id: Date.now(),
                format: finalFormat,
                ...(finalFormat === "aac" ? { container: actualMime } : {}),
                audio_base64: base64String,
                sample_rate: sampleRateFromCtx,
                sample_width: 2,
              };
              resolve();
            };
            reader.readAsDataURL(audioBlob);

        });
    };

    private sendDataToStreamlit = () => {
        //console.log("Sending data to streamlit...")
        if (this.output) {
            Streamlit.setComponentValue(this.output);
        }
    };

    private processAndSendRecording = async () => {
        await this.processRecording();
        //console.log("Processing finished")
        this.sendDataToStreamlit();
        //console.log("Data sent to Streamlit")
        // Cleanup graph + mic + context
        try { this.stopGraph && this.stopGraph(); } catch (e) { /* no-op */ } finally { this.stopGraph = undefined; }
        // Reset class variables
        this.mediaRecorder=undefined
        this.audioChunks = [];
        this.output=undefined
    };
}

export default withStreamlitConnection(MicRecorder);