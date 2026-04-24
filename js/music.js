// ============================================================================
// Volt Defense — Music Module
// Manages background music playback with shuffle/cycle between tracks.
// ============================================================================

var Music = (function () {
    var STORAGE_KEY = 'voltdefense_music';
    var _tracks = ['assets/music/track1.mp3', 'assets/music/track2.mp3'];
    var _audio = null;
    var _enabled = true;
    var _volume = 0.5;
    var _currentIndex = -1;
    var _shuffleOrder = [];
    var _shufflePos = 0;

    // ---- Settings persistence -----------------------------------------------

    function _loadSettings() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                if (typeof data.enabled === 'boolean') _enabled = data.enabled;
                if (typeof data.volume === 'number') _volume = data.volume;
            }
        } catch (e) {
            // use defaults
        }
    }

    function _saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                enabled: _enabled,
                volume: _volume
            }));
        } catch (e) {
            // silent
        }
    }

    // ---- Shuffle logic ------------------------------------------------------

    function _buildShuffleOrder() {
        _shuffleOrder = [];
        var i;
        for (i = 0; i < _tracks.length; i++) {
            _shuffleOrder.push(i);
        }
        // Fisher-Yates shuffle
        for (i = _shuffleOrder.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = _shuffleOrder[i];
            _shuffleOrder[i] = _shuffleOrder[j];
            _shuffleOrder[j] = tmp;
        }
        _shufflePos = 0;
    }

    function _nextTrackIndex() {
        if (_shuffleOrder.length === 0 || _shufflePos >= _shuffleOrder.length) {
            _buildShuffleOrder();
            // Avoid repeating last track
            if (_shuffleOrder.length > 1 && _shuffleOrder[0] === _currentIndex) {
                var tmp = _shuffleOrder[0];
                _shuffleOrder[0] = _shuffleOrder[_shuffleOrder.length - 1];
                _shuffleOrder[_shuffleOrder.length - 1] = tmp;
            }
        }
        var idx = _shuffleOrder[_shufflePos];
        _shufflePos++;
        return idx;
    }

    // ---- Audio management ---------------------------------------------------

    function _ensureAudio() {
        if (!_audio) {
            _audio = new Audio();
            _audio.volume = _volume;
            _audio.addEventListener('ended', function () {
                _playNext();
            });
        }
    }

    function _playNext() {
        _ensureAudio();
        _currentIndex = _nextTrackIndex();
        _audio.src = _tracks[_currentIndex];
        _audio.volume = _volume;
        _audio.play().catch(function () {
            // Autoplay blocked — will retry on user interaction
        });
    }

    // ---- Init ---------------------------------------------------------------

    _loadSettings();

    // ---- Public API ---------------------------------------------------------

    return {
        play: function () {
            if (!_enabled) return;
            _ensureAudio();
            if (_audio.src && !_audio.ended && _audio.currentTime > 0) {
                _audio.play().catch(function () {});
            } else {
                _playNext();
            }
        },

        pause: function () {
            if (_audio) {
                _audio.pause();
            }
        },

        toggle: function () {
            _enabled = !_enabled;
            _saveSettings();
            if (_enabled) {
                Music.play();
            } else {
                Music.pause();
            }
            return _enabled;
        },

        setVolume: function (val) {
            _volume = Math.max(0, Math.min(1, val));
            if (_audio) _audio.volume = _volume;
            _saveSettings();
        },

        getVolume: function () {
            return _volume;
        },

        isEnabled: function () {
            return _enabled;
        }
    };
})();
