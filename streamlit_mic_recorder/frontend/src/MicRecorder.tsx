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

        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }).then(stream => {
            const requestedFormat = this.props.args['format'];
            const preferredMime = this.getPreferredMimeType(requestedFormat);
            try {
                this.mediaRecorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
            } catch (e) {
                // Fallback to browser default if our preferred type isn't constructible.
                this.mediaRecorder = new MediaRecorder(stream);
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

            this.mediaRecorder.start();

            this.setState({ recording: true });
        }).catch(error => {
            console.error("Error initializing media recording: ", error);
        });
    };

    private stopRecording = async () => {
        if (this.mediaRecorder) {
            //console.log("Component stops recording");
            this.mediaRecorder.stop();
            this.setState({ recording: false });   
        }
    };

    private processRecording = async () => {
        //console.log("Component processing the recording...");
        return new Promise<void>(async (resolve) => {
        
            const requestedFormat = this.props.args['format'];
            const blobType = this.getBlobTypeForFormat(requestedFormat, this.mediaRecorder?.mimeType);
            const audioBlob = new Blob(this.audioChunks, { type: blobType });
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const sampleRate = audioBuffer.sampleRate;

            // For WebM, you can directly prepare the data to send
            if (this.props.args['format'] === 'webm') {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64String = reader.result?.toString().split(',')[1];
                    this.output = {
                        id: Date.now(),
                        format:"webm",
                        audio_base64: base64String,
                        sample_rate: sampleRate,
                        sample_width: 2
                    };
                    resolve();
                };
                reader.readAsDataURL(audioBlob);
            } else if (this.props.args['format'] === 'wav') {

                const wav: ArrayBuffer = toWav(audioBuffer);
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64String = reader.result?.toString().split(',')[1];
                    this.output = {
                        id:Date.now(),
                        format:"wav",
                        audio_base64: base64String,
                        sample_rate: sampleRate,
                        sample_width: 2
                    };
                    resolve();
                };
                reader.readAsDataURL(new Blob([wav], { type: 'audio/wav' }));
            } else if (this.props.args['format'] === 'aac') {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64String = reader.result?.toString().split(',')[1];
                    this.output = {
                        id: Date.now(),
                        format: "aac",
                        container: (this.mediaRecorder?.mimeType || blobType), // e.g., "audio/mp4;codecs=mp4a.40.2"
                        audio_base64: base64String,
                        sample_rate: sampleRate,
                        sample_width: 2
                    };
                    resolve();
                };
                reader.readAsDataURL(audioBlob);
            };
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
        
        // Reset class variables
        this.mediaRecorder=undefined
        this.audioChunks = [];
        this.output=undefined
    };
}

export default withStreamlitConnection(MicRecorder);