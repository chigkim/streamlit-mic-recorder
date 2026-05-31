import React from 'react';
import { StreamlitComponentBase, Streamlit, withStreamlitConnection } from 'streamlit-component-lib';
import toWav from 'audiobuffer-to-wav';
import './styles.css';
import tinycolor from 'tinycolor2'

interface State {
    recording: boolean;
    isHovered: boolean;
    devices: MediaDeviceInfo[];
    selectedDeviceId?: string;
    userSelectedDevice: boolean;
}

class MicRecorder extends StreamlitComponentBase<State> {

    private mediaRecorder?: MediaRecorder;
    private audioChunks: Blob[] = [];
    private output?:object;
    private srcStream?: MediaStream;                // raw mic
    private monoStream?: MediaStream;               // graph output (mono)
    private audioCtx?: AudioContext;                // web audio context
    private stopGraph?: () => void;                 // teardown helper
    private readonly selectedDeviceStorageKey = 'streamlit_mic_recorder_selected_device_id';
    public state: State = {
        recording: false,
        isHovered: false,
        devices: [],
        selectedDeviceId: undefined,
        userSelectedDevice: false,
    };

    private isIphoneLabel = (label?: string): boolean => {
        return (label || '').toLowerCase().includes('iphone');
    }

    private handleMouseEnter = () => {
        this.setState({ isHovered: true });
    }
    
    private handleMouseLeave = () => {
        this.setState({ isHovered: false });
    }

    public componentDidMount(): void {
        super.componentDidMount()
        ///console.log("Component mounted")
        navigator.mediaDevices?.addEventListener?.('devicechange', this.refreshDevices);
        this.refreshDevices();
    }

    public componentWillUnmount(): void {
        navigator.mediaDevices?.removeEventListener?.('devicechange', this.refreshDevices);
    }

    // Enumerate available audio input devices. Device labels are only readable
    // after microphone permission has been granted. We deliberately do NOT call
    // getUserMedia here so we don't trigger the permission prompt before the user
    // clicks Record. Labels are refreshed from startRecording once permission is
    // granted (the dropdown shows generic names until then).
    private refreshDevices = async (): Promise<void> => {
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            const inputs = all.filter(d => d.kind === 'audioinput');

            this.setState(prev => {
                let selected = prev.selectedDeviceId;
                let userSelectedDevice = prev.userSelectedDevice;
                // Restore the user's previous explicit mic choice across Streamlit
                // page changes. Browser permission is remembered by origin, but our
                // custom dropdown state is not unless we persist it.
                const storedSelected = (() => {
                    try { return window.localStorage.getItem(this.selectedDeviceStorageKey) || undefined; }
                    catch { return undefined; }
                })();
                if (!selected && storedSelected && inputs.some(d => d.deviceId === storedSelected)) {
                    selected = storedSelected;
                    userSelectedDevice = true;
                }

                // Keep the UI on the selected device if it's still present. Don't
                // silently switch devices here; the dropdown should reflect what the
                // browser actually opens, which we sync after getUserMedia.
                const stillValid = !!selected && inputs.some(d => d.deviceId === selected);
                if (!stillValid) {
                    selected = inputs[0]?.deviceId;
                    userSelectedDevice = false;
                }
                return { devices: inputs, selectedDeviceId: selected, userSelectedDevice };
            });
        } catch (e) {
            console.error('enumerateDevices failed:', e);
        }
    }

    private onSelectDevice = (e: React.ChangeEvent<HTMLSelectElement>): void => {
        const deviceId = e.target.value;
        const label = this.state.devices.find(d => d.deviceId === deviceId)?.label;
        if (this.isIphoneLabel(label)) {
            window.alert('iPhone microphone is not supported. Please select your Mac internal microphone or an external microphone.');
        }
        try { window.localStorage.setItem(this.selectedDeviceStorageKey, deviceId); } catch {}
        this.setState({ selectedDeviceId: deviceId, userSelectedDevice: true });
    }

    private syncSelectedDeviceToTrack = (track?: MediaStreamTrack, userSelectedDevice = this.state.userSelectedDevice): void => {
        if (!track) return;
        const settings = (track.getSettings?.() ?? {}) as any;
        const actualDeviceId = settings.deviceId
            || this.state.devices.find(d => d.label && d.label === track.label)?.deviceId;
        if (actualDeviceId && this.state.devices.some(d => d.deviceId === actualDeviceId)) {
            this.setState({ selectedDeviceId: actualDeviceId, userSelectedDevice });
        }
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
        const selectStyle: React.CSSProperties = {
            ...this.props.args["use_container_width"] ? { width: '100%' } : {},
            marginBottom: '8px',
            color: Theme.textColor,
            backgroundColor: Theme.backgroundColor,
            borderColor: tinycolor.mix(Theme.textColor, Theme.backgroundColor, 80).toString(),
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '0.5rem',
            padding: '4px 8px',
        };
        const selectedIsIphone = this.isIphoneLabel(
            this.state.devices.find(d => d.deviceId === this.state.selectedDeviceId)?.label
        );
        return (
            <div className="App">
                {this.state.devices.length > 0 && (
                    <select
                        className="micSelect"
                        style={selectStyle}
                        value={this.state.selectedDeviceId ?? ''}
                        onChange={this.onSelectDevice}
                        disabled={this.state.recording}
                    >
                        {this.state.devices.map((d, i) => {
                            const label = d.label || `Microphone ${i + 1}`;
                            return (
                                <option key={d.deviceId || i} value={d.deviceId}>
                                    {label}
                                </option>
                            );
                        })}
                    </select>
                )}
                <button 
                    className="myButton" 
                    style={this.buttonStyle(Theme)} 
                    onClick={this.onClick}
                    onMouseEnter={this.handleMouseEnter}
                    onMouseLeave={this.handleMouseLeave}
                    disabled={selectedIsIphone}
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

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            window.alert('Audio recording is not available. This usually means the page is not served over a secure context (https or localhost). getUserMedia requires HTTPS.');
            return;
        }

        // AGC is left off: with it enabled, Safari ramped gain slowly so recordings
        // started quiet and jumped to full volume mid-clip. The Safari low-volume
        // issue is instead addressed by summing L+R into mono in the audio graph
        // below (Safari places the mic signal only on the left channel).
        const audioConstraints: MediaTrackConstraints = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        // Honor the user's explicit choice with `exact`. An `ideal` hint isn't
        // enough: Chrome ignores it and keeps the OS default (e.g. an iPhone
        // Continuity mic), so picking the Mac mic would still open the iPhone. If
        // the chosen device turns out to be unavailable, getStream() below retries
        // without the constraint and we sync the dropdown to the browser's default.
        if (this.state.userSelectedDevice && this.state.selectedDeviceId) {
            audioConstraints.deviceId = { exact: this.state.selectedDeviceId };
        }

        const getStream = async (): Promise<MediaStream> => {
            try {
                return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            } catch (err) {
                const name = (err && (err as any).name) || '';
                if ((name === 'OverconstrainedError' || name === 'NotFoundError') && (audioConstraints as any).deviceId) {
                    // Chosen device can't be used: fall back to the browser default
                    // and let the post-permission sync reflect what it actually opened.
                    delete (audioConstraints as any).deviceId;
                    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                }
                throw err;
            }
        };

        getStream().then(async (stream) => {
            const selectedTrack = stream.getAudioTracks()[0];

            // Now that permission is granted, re-enumerate to get real deviceIds and
            // labels (before permission they are blank, so the dropdown only shows a
            // single generic "Microphone 1"). We then sync the selection to whatever
            // device the browser actually opened, so the dropdown mirrors reality.
            const all = await navigator.mediaDevices.enumerateDevices();
            const inputs = all.filter(d => d.kind === 'audioinput');
            const trackSettings = (selectedTrack?.getSettings?.() ?? {}) as any;
            const actualDeviceId = trackSettings.deviceId
                || inputs.find(d => d.label && d.label === selectedTrack?.label)?.deviceId;
            const actualSelected = (actualDeviceId && inputs.some(d => d.deviceId === actualDeviceId))
                ? actualDeviceId
                : inputs[0]?.deviceId;
            this.setState({ devices: inputs, selectedDeviceId: actualSelected });

            // If the browser ended up opening an iPhone mic (e.g. Chrome defaults to
            // it after the user clicks Allow), keep it selected so the dropdown still
            // mirrors the browser's choice and the button dims, but stop the stream,
            // warn the user, and abort recording.
            if (this.isIphoneLabel(selectedTrack?.label)) {
                stream.getTracks().forEach(t => t.stop());
                window.alert('iPhone microphone is not supported. Please select your Mac internal microphone or an external microphone.');
                return;
            }

            this.srcStream = stream;

            // 2) Build Web Audio graph: L+R -> sum -> mono -> MediaStream destination
            const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
            this.audioCtx = new Ctor({ sampleRate: 48000 }); // 48k plays best with Opus, fine for AAC/WAV
            const ctx = this.audioCtx!;
            if (ctx.state === "suspended") {
                await ctx.resume();
            }

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
            if (reportedCh === 1) {
              // Mono input: pass straight through to the mono destination.
              source.connect(dest);
            } else {
              // Stereo input: sum L + R into mono. Connecting both splitter
              // outputs into the same node sums them, so a signal present on
              // either channel (e.g. Safari placing it only on the left) is
              // preserved at full strength instead of being halved.
              const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
              source.connect(splitter);
              splitter.connect(dest, 0);   // L -> dest
              splitter.connect(dest, 1);   // R -> dest (summed)
              (this as any)._splitter = splitter;
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

            this.mediaRecorder.onstart = () => {
                this.setState({ recording: true });
            };

            this.mediaRecorder.start(1000);

        }).catch(error => {
            console.error("Error initializing media recording: ", error);
            const name = (error && (error as any).name) || '';
            let msg = 'Could not start recording: ' + (error?.message || error);
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                msg = 'Microphone permission was denied or blocked. If this is inside a Streamlit app, the component iframe must allow microphone access (Permissions-Policy), and you must allow the mic in your browser site settings.';
            } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
                msg = 'No usable microphone was found for the selected device. Try selecting a different microphone.';
            }
            window.alert(msg);
            // Make sure UI is reset if we toggled state anywhere.
            this.setState({ recording: false });
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