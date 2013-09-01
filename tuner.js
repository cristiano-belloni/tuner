define(['require', 'github:janesconference/KievII@jspm0.5/dist/kievII'], function(require, K2, Tuna) {
  
    var pluginConf = {
        name: "Tuner",
        osc: false,
        audioOut: 0,
        audioIn: 1,
        version: '0.0.1-alpha1',
        ui: {
            type: 'canvas',
            width: 250,
            height: 250
        }
    };
  
    var pluginFunction = function(args) {
        
        this.id = args.id;
        this.audioSource = args.audioSources[0];
        this.context = args.audioContext;
        this.labelFontSize = 20;

        // The canvas part
        this.ui = new K2.UI ({type: 'CANVAS2D', target: args.canvas});

        this.viewWidth = args.canvas.width;
        this.viewHeight = args.canvas.height;

        var gaugeArgs = {
            ID : "tunerGauge",
            left : Math.floor(this.viewWidth * 0.5 - this.viewWidth * 0.2),
            top : Math.floor(this.viewHeight * 0.5 - this.viewHeight * 0.2),
            height : 120,
            width : 120,
            onValueSet : function(slot, value) {
                this.ui.refresh();
            }.bind(this),
            isListening : false
        };

        this.ui.addElement(new K2.Gauge(gaugeArgs));
        this.ui.setValue({
            elementID : 'tunerGauge',
            slot : 'gaugevalue',
            value : 0.5
        });

        var tunerLabelArgs = {
            ID: 'tunerLabel',
            top: Math.floor(this.viewHeight / 2) - this.labelFontSize,
            left: 50,
            width: 120,
            height: this.labelFontSize,
            textColor: "white",
            transparency: 0.8,
            objParms: {
                font: this.labelFontSize + "pt Arial",
                textBaseline: "top",
                textAlign: "left"
            }
        };
        this.ui.addElement(new K2.Label (tunerLabelArgs));
        this.ui.setValue({
            elementID : 'tunerLabel',
            slot : 'labelvalue',
            value : '--'
        });

        this.ui.refresh();

        var isPlaying = false;
        var sourceNode = null;
        var analyser = null;
        var theBuffer = null;
        var detectorElem,
            canvasElem,
            pitchElem,
            noteElem,
            detuneElem,
            detuneAmount;

        this.convertToMono = function ( input ) {
            var splitter = this.context.createChannelSplitter(2);
            var merger = this.context.createChannelMerger(2);

            input.connect( splitter );
            splitter.connect( merger, 0, 0 );
            splitter.connect( merger, 0, 1 );
            return merger;
        }

        function error() {
            console.err ("Error TODO use the interface")
        }


        function togglePlayback() {
            var now = this.context.currentTime;

            if (isPlaying) {
                //stop playing and return
                analyser = null;
                isPlaying = false;
                if (!window.cancelAnimationFrame)
                    window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
                window.cancelAnimationFrame( rafID );
            }

        }

        var rafID = null;
        var tracks = null;
        var buflen = 1024;
        var buf = new Uint8Array( buflen );
        var MINVAL = 134;  // 128 == zero.  MINVAL is the "minimum detected signal" level.

        function findNextPositiveZeroCrossing( start ) {
            var i = Math.ceil( start );
            var last_zero = -1;
            // advance until we're zero or negative
            while (i<buflen && (buf[i] > 128 ) )
                i++;
            if (i>=buflen)
                return -1;

            // advance until we're above MINVAL, keeping track of last zero.
            while (i<buflen && ((t=buf[i]) < MINVAL )) {
                if (t >= 128) {
                    if (last_zero == -1)
                        last_zero = i;
                } else
                    last_zero = -1;
                i++;
            }

            // we may have jumped over MINVAL in one sample.
            if (last_zero == -1)
                last_zero = i;

            if (i==buflen)	// We didn't find any more positive zero crossings
                return -1;

            // The first sample might be a zero.  If so, return it.
            if (last_zero == 0)
                return 0;

            // Otherwise, the zero might be between two values, so we need to scale it.

            var t = ( 128 - buf[last_zero-1] ) / (buf[last_zero] - buf[last_zero-1]);
            return last_zero+t;
        }

        var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

        function noteFromPitch( frequency ) {
            var noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
            return Math.round( noteNum ) + 69;
        }

        function frequencyFromNoteNumber( note ) {
            return 440 * Math.pow(2,(note-69)/12);
        }

        function centsOffFromPitch( frequency, note ) {
            return Math.floor( 1200 * Math.log( frequency / frequencyFromNoteNumber( note ))/Math.log(2) );
        }

        this.updatePitch = function ( time ) {
            var cycles = new Array;
            analyser.getByteTimeDomainData( buf );

            var i=0;
            // find the first point
            var last_zero = findNextPositiveZeroCrossing( 0 );

            var n=0;
            // keep finding points, adding cycle lengths to array
            while ( last_zero != -1) {
                var next_zero = findNextPositiveZeroCrossing( last_zero + 1 );
                if (next_zero > -1)
                    cycles.push( next_zero - last_zero );
                last_zero = next_zero;

                n++;
                if (n>1000)
                    break;
            }

            // 1?: average the array
            var num_cycles = cycles.length;
            var sum = 0;
            var pitch = 0;

            for (var i=0; i<num_cycles; i++) {
                sum += cycles[i];
            }

            if (num_cycles) {
                sum /= num_cycles;
                pitch = this.context.sampleRate/sum;
            }

            // confidence = num_cycles / num_possible_cycles = num_cycles / (this.context.sampleRate/)
            var confidence = (num_cycles ? ((num_cycles/(pitch * buflen / this.context.sampleRate)) * 100) : 0);

            /*
             console.log(
             "Cycles: " + num_cycles +
             " - average length: " + sum +
             " - pitch: " + pitch + "Hz " +
             " - note: " + noteFromPitch( pitch ) +
             " - confidence: " + confidence + "% "
             );
             */
            // possible other approach to confidence: sort the array, take the median; go through the array and compute the average deviation

            //detectorElem.className = (confidence>50)?"confident":"vague";
            // TODO: Paint confidence meter on canvasElem here.

            if (num_cycles == 0) {
                // TODO write nothing in the label
                this.ui.setValue({
                    elementID : 'tunerLabel',
                    slot : 'labelvalue',
                    value : '--'
                });
                this.ui.refresh();
            } else {
                //TODO  pitch
                this.ui.setValue({
                    elementID : 'tunerGauge',
                    slot : 'gaugevalue',
                    value : pitch / 44100
                });

                var note =  noteFromPitch( pitch );
                // TODO label

                this.ui.setValue({
                    elementID : 'tunerLabel',
                    slot : 'labelvalue',
                    value : note
                });

                this.ui.refresh();

                var detune = centsOffFromPitch( pitch, note );
                if (detune == 0 ) {
                    // TODO write no detune in the label
                } else {
                    if (detune < 0) {
                        // TODO write flat in the label
                    }
                    else {
                        // TODO write sharp in the label
                    }
                    //detuneAmount.innerText = Math.abs( detune );
                }
            }

            if (!window.requestAnimationFrame)
                window.requestAnimationFrame = window.webkitRequestAnimationFrame;
            rafID = window.requestAnimationFrame( this.updatePitch.bind(this) );
        }

        analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        this.convertToMono( this.audioSource ).connect( analyser );
        this.updatePitch();

        // Initialization made it so far: plugin is ready.
        args.hostInterface.setInstanceStatus ('ready');
    };
    
    
    var initPlugin = function(initArgs) {
        var args = initArgs;

        pluginFunction.call (this, args);
            
    };
        
    return {
        initPlugin: initPlugin,
        pluginConf: pluginConf
    };
});
