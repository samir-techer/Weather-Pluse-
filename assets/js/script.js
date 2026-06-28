/* ============================================
   Weather Pluse+ - Main Application Script
   ============================================ */

(function() {
    'use strict';

    // ============================================
    // Configuration & State
    // ============================================
    const CONFIG = {
        API_BASE: 'https://api.openweathermap.org/data/2.5',
        GEO_API: 'https://api.openweathermap.org/geo/1.0',
        MAP_TILE_URL: 'https://tile.openweathermap.org/map',
        ICON_URL: 'https://openweathermap.org/img/wn',
        DEFAULT_CITY: { name: 'London', lat: 51.5074, lon: -0.1278, country: 'GB' },
        CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
        MAX_RECENT: 10,
        MAX_FAVORITES: 20
    };

    const state = {
        currentCity: null,
        weatherData: null,
        hourlyData: [],
        dailyData: [],
        favorites: [],
        recentSearches: [],
        settings: {
            tempUnit: 'celsius',
            windUnit: 'ms',
            darkMode: true,
            autoDark: false,
            alertsEnabled: true,
            dailyForecastEnabled: true,
            hourlyEnabled: false,
            autoLocation: true,
            apiKey: ''
        },
        isOnline: navigator.onLine,
        mapInstance: null,
        mapLayer: null,
        deferredPrompt: null
    };

    // ============================================
    // DOM Elements Cache
    // ============================================
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    // ============================================
    // Utility Functions
    // ============================================
    const utils = {
        formatTemp: (kelvin) => {
            if (!kelvin) return '--';
            if (state.settings.tempUnit === 'fahrenheit') {
                return Math.round((kelvin - 273.15) * 9/5 + 32);
            }
            return Math.round(kelvin - 273.15);
        },

        formatWind: (speed) => {
            if (!speed) return '--';
            const unit = state.settings.windUnit;
            if (unit === 'kmh') return (speed * 3.6).toFixed(1) + ' km/h';
            if (unit === 'mph') return (speed * 2.237).toFixed(1) + ' mph';
            return speed.toFixed(1) + ' m/s';
        },

        formatTime: (timestamp, timezone = 'UTC') => {
            if (!timestamp) return '--:--';
            const date = new Date(timestamp * 1000);
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: timezone !== 'UTC' ? timezone : undefined
            });
        },

        formatDate: (timestamp, timezone = 'UTC') => {
            if (!timestamp) return '--';
            const date = new Date(timestamp * 1000);
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                timeZone: timezone !== 'UTC' ? timezone : undefined
            });
        },

        formatDay: (timestamp) => {
            if (!timestamp) return '--';
            const date = new Date(timestamp * 1000);
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            if (date.toDateString() === today.toDateString()) return 'Today';
            if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
            return date.toLocaleDateString('en-US', { weekday: 'short' });
        },

        getWindDirection: (deg) => {
            if (!deg && deg !== 0) return '--';
            const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
            return directions[Math.round(deg / 22.5) % 16];
        },

        getUVLevel: (uvi) => {
            if (uvi <= 2) return { text: 'Low', color: '#10b981' };
            if (uvi <= 5) return { text: 'Moderate', color: '#eab308' };
            if (uvi <= 7) return { text: 'High', color: '#f97316' };
            if (uvi <= 10) return { text: 'Very High', color: '#ef4444' };
            return { text: 'Extreme', color: '#7c3aed' };
        },

        getAQILevel: (aqi) => {
            const levels = ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor'];
            const colors = ['#10b981', '#eab308', '#f97316', '#ef4444', '#7c3aed'];
            const index = Math.min(Math.max(aqi - 1, 0), 4);
            return { text: levels[index], color: colors[index] };
        },

        getMoonPhase: (phase) => {
            if (phase === 0 || phase === 1) return 'New Moon';
            if (phase < 0.25) return 'Waxing Crescent';
            if (phase === 0.25) return 'First Quarter';
            if (phase < 0.5) return 'Waxing Gibbous';
            if (phase === 0.5) return 'Full Moon';
            if (phase < 0.75) return 'Waning Gibbous';
            if (phase === 0.75) return 'Last Quarter';
            return 'Waning Crescent';
        },

        getWeatherIcon: (iconCode) => {
            return `${CONFIG.ICON_URL}/${iconCode}@2x.png`;
        },

        getWeatherAnimation: (condition, iconCode) => {
            const code = iconCode || '';
            const id = parseInt(code.substring(0, 2));

            if (code.includes('01')) return 'clear';
            if (code.includes('02') || code.includes('03') || code.includes('04')) return 'clouds';
            if (code.includes('09') || code.includes('10')) return 'rain';
            if (code.includes('11')) return 'thunderstorm';
            if (code.includes('13')) return 'snow';
            if (code.includes('50')) return 'fog';
            return 'clear';
        },

        debounce: (fn, delay) => {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => fn(...args), delay);
            };
        },

        storage: {
            get: (key, defaultValue = null) => {
                try {
                    const item = localStorage.getItem(key);
                    return item ? JSON.parse(item) : defaultValue;
                } catch (e) {
                    return defaultValue;
                }
            },
            set: (key, value) => {
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                } catch (e) {
                    console.warn('Storage error:', e);
                }
            },
            remove: (key) => {
                try {
                    localStorage.removeItem(key);
                } catch (e) {}
            }
        },

        showToast: (message, duration = 3000) => {
            const toast = $('#toast');
            const toastMessage = $('#toast-message');
            toastMessage.textContent = message;
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), duration);
        },

        showLoading: (show = true) => {
            const overlay = $('#loading-overlay');
            if (show) overlay.classList.remove('hidden');
            else overlay.classList.add('hidden');
        }
    };

    // ============================================
    // Weather Animation System
    // ============================================
    const weatherAnimations = {
        container: null,
        particles: [],
        animationId: null,

        init: () => {
            weatherAnimations.container = $('#particles-container');
        },

        clear: () => {
            if (weatherAnimations.animationId) {
                cancelAnimationFrame(weatherAnimations.animationId);
                weatherAnimations.animationId = null;
            }
            weatherAnimations.particles = [];
            if (weatherAnimations.container) {
                weatherAnimations.container.innerHTML = '';
            }
        },

        createRain: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 60; i++) {
                const drop = document.createElement('div');
                drop.className = 'rain-drop';
                drop.style.left = Math.random() * 100 + '%';
                drop.style.animationDuration = (0.5 + Math.random() * 0.5) + 's';
                drop.style.animationDelay = Math.random() * 2 + 's';
                drop.style.opacity = 0.3 + Math.random() * 0.4;
                container.appendChild(drop);
            }
        },

        createSnow: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 50; i++) {
                const flake = document.createElement('div');
                flake.className = 'snow-flake';
                flake.style.left = Math.random() * 100 + '%';
                flake.style.width = (3 + Math.random() * 5) + 'px';
                flake.style.height = flake.style.width;
                flake.style.animationDuration = (2 + Math.random() * 3) + 's';
                flake.style.animationDelay = Math.random() * 5 + 's';
                flake.style.opacity = 0.4 + Math.random() * 0.6;
                container.appendChild(flake);
            }
        },

        createClouds: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 5; i++) {
                const cloud = document.createElement('div');
                cloud.className = 'cloud-anim';
                cloud.style.width = (100 + Math.random() * 150) + 'px';
                cloud.style.height = (40 + Math.random() * 30) + 'px';
                cloud.style.top = (Math.random() * 40) + '%';
                cloud.style.left = (Math.random() * 80) + '%';
                cloud.style.animationDuration = (8 + Math.random() * 6) + 's';
                cloud.style.animationDelay = Math.random() * 4 + 's';
                container.appendChild(cloud);
            }
        },

        createSun: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            const sun = document.createElement('div');
            sun.className = 'sun-anim';
            sun.style.top = '10%';
            sun.style.right = '10%';
            sun.style.animationDuration = '3s';
            container.appendChild(sun);

            // Add rays
            for (let i = 0; i < 8; i++) {
                const ray = document.createElement('div');
                ray.style.position = 'absolute';
                ray.style.width = '3px';
                ray.style.height = '30px';
                ray.style.background = 'linear-gradient(to bottom, #fbbf24, transparent)';
                ray.style.top = '10%';
                ray.style.right = '15%';
                ray.style.transformOrigin = 'center 60px';
                ray.style.transform = `rotate(${i * 45}deg)`;
                ray.style.animation = 'sunPulse 3s ease-in-out infinite';
                ray.style.animationDelay = (i * 0.2) + 's';
                container.appendChild(ray);
            }
        },

        createThunderstorm: () => {
            weatherAnimations.createRain();
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 3; i++) {
                const lightning = document.createElement('div');
                lightning.className = 'lightning-anim';
                lightning.style.left = (20 + Math.random() * 60) + '%';
                lightning.style.top = (10 + Math.random() * 30) + '%';
                lightning.style.animationDuration = (3 + Math.random() * 4) + 's';
                lightning.style.animationDelay = Math.random() * 3 + 's';
                container.appendChild(lightning);
            }
        },

        createFog: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 6; i++) {
                const fog = document.createElement('div');
                fog.className = 'fog-anim';
                fog.style.width = (200 + Math.random() * 300) + 'px';
                fog.style.top = (20 + Math.random() * 60) + '%';
                fog.style.animationDuration = (10 + Math.random() * 10) + 's';
                fog.style.animationDelay = Math.random() * 5 + 's';
                container.appendChild(fog);
            }
        },

        createStars: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 80; i++) {
                const star = document.createElement('div');
                star.className = 'star-anim';
                star.style.left = Math.random() * 100 + '%';
                star.style.top = Math.random() * 60 + '%';
                star.style.width = (1 + Math.random() * 3) + 'px';
                star.style.height = star.style.width;
                star.style.animationDuration = (1 + Math.random() * 3) + 's';
                star.style.animationDelay = Math.random() * 3 + 's';
                container.appendChild(star);
            }
        },

        createWind: () => {
            const container = weatherAnimations.container;
            if (!container) return;

            for (let i = 0; i < 15; i++) {
                const line = document.createElement('div');
                line.className = 'wind-line';
                line.style.width = (50 + Math.random() * 100) + 'px';
                line.style.top = (Math.random() * 80) + '%';
                line.style.animationDuration = (1 + Math.random() * 2) + 's';
                line.style.animationDelay = Math.random() * 3 + 's';
                container.appendChild(line);
            }
        },

        setAnimation: (type) => {
            weatherAnimations.clear();

            switch(type) {
                case 'rain':
                    weatherAnimations.createRain();
                    break;
                case 'snow':
                    weatherAnimations.createSnow();
                    break;
                case 'clouds':
                    weatherAnimations.createClouds();
                    break;
                case 'clear':
                    weatherAnimations.createSun();
                    break;
                case 'thunderstorm':
                    weatherAnimations.createThunderstorm();
                    break;
                case 'fog':
                    weatherAnimations.createFog();
                    break;
                case 'wind':
                    weatherAnimations.createWind();
                    break;
                default:
                    weatherAnimations.createSun();
            }
        }
    };

    // ============================================
    // API Functions
    // ============================================
    const api = {
        getApiKey: () => {
            return state.settings.apiKey || '';
        },

        searchCity: async (query) => {
            const apiKey = api.getApiKey();
            if (!apiKey) {
                utils.showToast('Please add your OpenWeather API key in Settings');
                return [];
            }

            try {
                const response = await fetch(
                    `${CONFIG.GEO_API}/direct?q=${encodeURIComponent(query)}&limit=5&appid=${apiKey}`
                );
                if (!response.ok) throw new Error('Search failed');
                return await response.json();
            } catch (error) {
                console.error('Search error:', error);
                utils.showToast('Search failed. Please check your API key.');
                return [];
            }
        },

        getCurrentWeather: async (lat, lon) => {
            const apiKey = api.getApiKey();
            if (!apiKey) return null;

            try {
                const response = await fetch(
                    `${CONFIG.API_BASE}/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`
                );
                if (!response.ok) throw new Error('Weather fetch failed');
                return await response.json();
            } catch (error) {
                console.error('Weather error:', error);
                return null;
            }
        },

        getForecast: async (lat, lon) => {
            const apiKey = api.getApiKey();
            if (!apiKey) return null;

            try {
                const response = await fetch(
                    `${CONFIG.API_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}`
                );
                if (!response.ok) throw new Error('Forecast fetch failed');
                return await response.json();
            } catch (error) {
                console.error('Forecast error:', error);
                return null;
            }
        },

        getAirQuality: async (lat, lon) => {
            const apiKey = api.getApiKey();
            if (!apiKey) return null;

            try {
                const response = await fetch(
                    `${CONFIG.API_BASE}/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`
                );
                if (!response.ok) throw new Error('AQI fetch failed');
                return await response.json();
            } catch (error) {
                console.error('AQI error:', error);
                return null;
            }
        },

        getWeatherIconUrl: (icon) => {
            return `${CONFIG.ICON_URL}/${icon}@2x.png`;
        }
    };

    // ============================================
    // Data Processing
    // ============================================
    const dataProcessor = {
        processHourly: (forecastData) => {
            if (!forecastData || !forecastData.list) return [];

            const hourly = forecastData.list.slice(0, 24).map(item => ({
                time: item.dt,
                temp: item.main.temp,
                feelsLike: item.main.feels_like,
                humidity: item.main.humidity,
                windSpeed: item.wind.speed,
                windDeg: item.wind.deg,
                pop: item.pop || 0,
                weather: item.weather[0],
                visibility: item.visibility
            }));

            return hourly;
        },

        processDaily: (forecastData) => {
            if (!forecastData || !forecastData.list) return [];

            const dailyMap = new Map();

            forecastData.list.forEach(item => {
                const date = new Date(item.dt * 1000).toDateString();

                if (!dailyMap.has(date)) {
                    dailyMap.set(date, {
                        dt: item.dt,
                        temps: [],
                        weather: item.weather[0],
                        pop: item.pop || 0,
                        humidity: [],
                        windSpeed: [],
                        pressure: []
                    });
                }

                const day = dailyMap.get(date);
                day.temps.push(item.main.temp);
                day.humidity.push(item.main.humidity);
                day.windSpeed.push(item.wind.speed);
                day.pressure.push(item.main.pressure);
                day.pop = Math.max(day.pop, item.pop || 0);
            });

            return Array.from(dailyMap.values()).slice(0, 7).map(day => ({
                dt: day.dt,
                tempMin: Math.min(...day.temps),
                tempMax: Math.max(...day.temps),
                tempAvg: day.temps.reduce((a, b) => a + b, 0) / day.temps.length,
                weather: day.weather,
                pop: day.pop,
                humidity: Math.round(day.humidity.reduce((a, b) => a + b, 0) / day.humidity.length),
                windSpeed: (day.windSpeed.reduce((a, b) => a + b, 0) / day.windSpeed.length).toFixed(1),
                pressure: Math.round(day.pressure.reduce((a, b) => a + b, 0) / day.pressure.length)
            }));
        }
    };

    // ============================================
    // UI Rendering
    // ============================================
    const ui = {
        renderCurrentWeather: (data, aqiData) => {
            if (!data) return;

            const city = state.currentCity;
            $('#header-city').textContent = city.name;
            $('#header-country').textContent = city.country || '';

            $('#current-time').textContent = new Date().toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', hour12: true
            });
            $('#current-date').textContent = new Date().toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric'
            });

            $('#current-temp').innerHTML = utils.formatTemp(data.main.temp) + '&deg;';
            $('#current-feels-like').textContent = `Feels like ${utils.formatTemp(data.main.feels_like)}°`;
            $('#current-condition').textContent = data.weather[0].description;

            // Calculate high/low from forecast if available
            const today = new Date().toDateString();
            const todayForecasts = state.hourlyData.filter(h => 
                new Date(h.time * 1000).toDateString() === today
            );

            if (todayForecasts.length > 0) {
                const temps = todayForecasts.map(h => h.temp);
                $('#current-high').innerHTML = utils.formatTemp(Math.max(...temps)) + '&deg;';
                $('#current-low').innerHTML = utils.formatTemp(Math.min(...temps)) + '&deg;';
            } else {
                $('#current-high').innerHTML = utils.formatTemp(data.main.temp_max) + '&deg;';
                $('#current-low').innerHTML = utils.formatTemp(data.main.temp_min) + '&deg;';
            }

            $('#current-rain').textContent = Math.round((data.rain?.['1h'] || 0) * 100) + '%';

            // Weather icon
            const iconUrl = api.getWeatherIconUrl(data.weather[0].icon);
            const iconImg = $('#current-weather-icon');
            iconImg.src = iconUrl;
            iconImg.classList.remove('hidden');

            // Set weather animation
            const animType = utils.getWeatherAnimation(data.weather[0].main, data.weather[0].icon);
            weatherAnimations.setAnimation(animType);

            // Update details
            $('#detail-humidity').textContent = data.main.humidity + '%';
            $('#detail-pressure').textContent = data.main.pressure + ' hPa';
            $('#detail-visibility').textContent = ((data.visibility || 10000) / 1000).toFixed(1) + ' km';
            $('#detail-clouds').textContent = (data.clouds?.all || 0) + '%';
            $('#detail-wind-speed').textContent = utils.formatWind(data.wind.speed);
            $('#detail-wind-dir').textContent = utils.getWindDirection(data.wind.deg);

            const uvInfo = utils.getUVLevel(data.uvi || 0);
            $('#detail-uv').innerHTML = `<span style="color:${uvInfo.color}">${data.uvi || 0} ${uvInfo.text}</span>`;

            if (aqiData && aqiData.list && aqiData.list[0]) {
                const aqi = aqiData.list[0].main.aqi;
                const aqiInfo = utils.getAQILevel(aqi);
                $('#detail-aqi').innerHTML = `<span style="color:${aqiInfo.color}">${aqi} ${aqiInfo.text}</span>`;
            } else {
                $('#detail-aqi').textContent = '--';
            }

            $('#detail-sunrise').textContent = utils.formatTime(data.sys.sunrise);
            $('#detail-sunset').textContent = utils.formatTime(data.sys.sunset);
            $('#detail-moon').textContent = utils.getMoonPhase(0.5); // Default
            $('#detail-dew').innerHTML = utils.formatTemp(data.main.dew_point || data.main.temp - 5) + '&deg;';
        },

        renderHourlyChart: () => {
            const canvas = $('#hourly-chart');
            if (!canvas || state.hourlyData.length === 0) return;

            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();

            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const width = rect.width;
            const height = rect.height;
            const padding = { top: 20, right: 20, bottom: 30, left: 40 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;

            const temps = state.hourlyData.map(h => utils.formatTemp(h.temp));
            const minTemp = Math.min(...temps) - 2;
            const maxTemp = Math.max(...temps) + 2;
            const tempRange = maxTemp - minTemp || 1;

            // Clear
            ctx.clearRect(0, 0, width, height);

            // Grid lines
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim();
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= 4; i++) {
                const y = padding.top + (chartHeight / 4) * i;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                const temp = Math.round(maxTemp - (tempRange / 4) * i);
                ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
                ctx.font = '10px Inter';
                ctx.textAlign = 'right';
                ctx.fillText(temp + '°', padding.left - 8, y + 3);
            }

            // Draw line
            const points = state.hourlyData.map((h, i) => ({
                x: padding.left + (chartWidth / (state.hourlyData.length - 1)) * i,
                y: padding.top + chartHeight - ((utils.formatTemp(h.temp) - minTemp) / tempRange) * chartHeight
            }));

            // Gradient fill
            const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
            gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

            ctx.beginPath();
            ctx.moveTo(points[0].x, height - padding.bottom);
            points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();

            // Draw line
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Draw points
            points.forEach((p, i) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#3b82f6';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Time labels
                if (i % 3 === 0) {
                    const time = new Date(state.hourlyData[i].time * 1000).getHours();
                    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
                    ctx.font = '10px Inter';
                    ctx.textAlign = 'center';
                    ctx.fillText(time + ':00', p.x, height - 8);
                }
            });
        },

        renderHourlyList: () => {
            const container = $('#hourly-list');
            if (!container) return;

            container.innerHTML = state.hourlyData.slice(0, 24).map((hour, index) => {
                const time = new Date(hour.time * 1000);
                const hourNum = time.getHours();
                const isNow = index === 0;
                const iconUrl = api.getWeatherIconUrl(hour.weather.icon);

                return `
                    <div class="hourly-item ${isNow ? 'now' : ''}">
                        <span class="hourly-time">${isNow ? 'Now' : hourNum + ':00'}</span>
                        <div class="hourly-icon">
                            <img src="${iconUrl}" alt="${hour.weather.description}" loading="lazy">
                        </div>
                        <span class="hourly-temp">${utils.formatTemp(hour.temp)}°</span>
                        ${hour.pop > 0 ? `<span class="hourly-pop">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
                            ${Math.round(hour.pop * 100)}%
                        </span>` : '<span class="hourly-pop"></span>'}
                    </div>
                `;
            }).join('');
        },

        renderDailyList: () => {
            const container = $('#daily-list');
            if (!container) return;

            const days = state.dailyData;
            const allTemps = days.flatMap(d => [utils.formatTemp(d.tempMin), utils.formatTemp(d.tempMax)]);
            const minAll = Math.min(...allTemps);
            const maxAll = Math.max(...allTemps);
            const range = maxAll - minAll || 1;

            container.innerHTML = days.map(day => {
                const iconUrl = api.getWeatherIconUrl(day.weather.icon);
                const low = utils.formatTemp(day.tempMin);
                const high = utils.formatTemp(day.tempMax);
                const barStart = ((low - minAll) / range) * 100;
                const barWidth = ((high - low) / range) * 100;

                return `
                    <div class="daily-item">
                        <span class="daily-day">${utils.formatDay(day.dt)}</span>
                        <div class="daily-icon">
                            <img src="${iconUrl}" alt="${day.weather.description}" loading="lazy">
                        </div>
                        <span class="daily-condition">${day.weather.description}</span>
                        ${day.pop > 0.1 ? `<span class="daily-pop">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
                            ${Math.round(day.pop * 100)}%
                        </span>` : '<span></span>'}
                        <div class="daily-temps">
                            <span class="daily-high">${high}°</span>
                            <div class="daily-temp-bar">
                                <div class="daily-temp-bar-fill" style="left:${barStart}%;width:${barWidth}%"></div>
                            </div>
                            <span class="daily-low">${low}°</span>
                        </div>
                    </div>
                `;
            }).join('');
        },

        renderFavorites: () => {
            const container = $('#favorites-container');
            const listSearch = $('#favorites-list-search');

            if (state.favorites.length === 0) {
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                            <p>No favorites yet</p>
                            <p class="empty-sub">Search for a city and tap the star to add it</p>
                        </div>
                    `;
                }
                if (listSearch) listSearch.innerHTML = '';
                return;
            }

            const renderFavoriteItem = (city) => `
                <div class="favorite-city-card" data-lat="${city.lat}" data-lon="${city.lon}" data-name="${city.name}">
                    <div class="favorite-city-info">
                        <span class="favorite-city-name">${city.name}</span>
                        <span class="favorite-city-country">${city.country || ''}</span>
                    </div>
                    <button class="favorite-btn active" data-city="${city.name}" onclick="event.stopPropagation(); app.removeFavorite('${city.name}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    </button>
                </div>
            `;

            if (container) {
                container.innerHTML = state.favorites.map(renderFavoriteItem).join('');

                container.querySelectorAll('.favorite-city-card').forEach(card => {
                    card.addEventListener('click', () => {
                        const city = {
                            name: card.dataset.name,
                            lat: parseFloat(card.dataset.lat),
                            lon: parseFloat(card.dataset.lon)
                        };
                        app.loadCityWeather(city);
                        app.navigateTo('home');
                    });
                });
            }

            if (listSearch) {
                listSearch.innerHTML = state.favorites.map(city => `
                    <div class="favorite-item" data-lat="${city.lat}" data-lon="${city.lon}" data-name="${city.name}">
                        <div class="search-result-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        </div>
                        <div class="search-result-info">
                            <span class="search-result-name">${city.name}</span>
                            <span class="search-result-country">${city.country || ''}</span>
                        </div>
                        <button class="favorite-btn active" onclick="event.stopPropagation(); app.removeFavorite('${city.name}')">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                    </div>
                `).join('');

                listSearch.querySelectorAll('.favorite-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const city = {
                            name: item.dataset.name,
                            lat: parseFloat(item.dataset.lat),
                            lon: parseFloat(item.dataset.lon)
                        };
                        app.loadCityWeather(city);
                        app.toggleSearch(false);
                    });
                });
            }
        },

        renderSearchResults: (results) => {
            const container = $('#search-results');
            if (!container) return;

            if (results.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No cities found</p></div>';
                return;
            }

            container.innerHTML = results.map(city => {
                const isFav = state.favorites.some(f => f.name === city.name && f.lat === city.lat);
                return `
                    <div class="search-result-item" data-lat="${city.lat}" data-lon="${city.lon}" data-name="${city.name}" data-country="${city.country || ''}">
                        <div class="search-result-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        </div>
                        <div class="search-result-info">
                            <span class="search-result-name">${city.name}</span>
                            <span class="search-result-country">${city.state ? city.state + ', ' : ''}${city.country || ''}</span>
                        </div>
                        <button class="favorite-btn ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); app.toggleFavorite({name:'${city.name}',lat:${city.lat},lon:${city.lon},country:'${city.country || ''}'})" aria-label="Toggle favorite">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                    </div>
                `;
            }).join('');

            container.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const city = {
                        name: item.dataset.name,
                        lat: parseFloat(item.dataset.lat),
                        lon: parseFloat(item.dataset.lon),
                        country: item.dataset.country
                    };
                    app.addRecentSearch(city);
                    app.loadCityWeather(city);
                    app.toggleSearch(false);
                });
            });
        },

        renderRecentSearches: () => {
            const container = $('#recent-list');
            if (!container) return;

            if (state.recentSearches.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding:20px"><p style="font-size:0.85rem">No recent searches</p></div>';
                return;
            }

            container.innerHTML = state.recentSearches.map(city => `
                <div class="recent-item" data-lat="${city.lat}" data-lon="${city.lon}" data-name="${city.name}">
                    <div class="recent-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>
                    </div>
                    <div class="recent-info">
                        <span class="recent-name">${city.name}</span>
                        <span class="recent-country">${city.country || ''}</span>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.recent-item').forEach(item => {
                item.addEventListener('click', () => {
                    const city = {
                        name: item.dataset.name,
                        lat: parseFloat(item.dataset.lat),
                        lon: parseFloat(item.dataset.lon)
                    };
                    app.loadCityWeather(city);
                    app.toggleSearch(false);
                });
            });
        },

        renderAlerts: (alerts) => {
            const section = $('#alerts-section');
            const list = $('#alerts-list');

            if (!alerts || alerts.length === 0) {
                if (section) section.classList.add('hidden');
                return;
            }

            if (section) section.classList.remove('hidden');
            if (list) {
                list.innerHTML = alerts.map(alert => `
                    <div class="alert-item">
                        <div class="alert-title">${alert.event || 'Weather Alert'}</div>
                        <div class="alert-description">${alert.description || ''}</div>
                        <div class="alert-time">${alert.start ? utils.formatTime(alert.start) : ''} - ${alert.end ? utils.formatTime(alert.end) : ''}</div>
                    </div>
                `).join('');
            }
        },

        initMap: () => {
            if (state.mapInstance) return;

            const mapContainer = $('#weather-map');
            if (!mapContainer || typeof L === 'undefined') return;

            const city = state.currentCity || CONFIG.DEFAULT_CITY;

            state.mapInstance = L.map('weather-map').setView([city.lat, city.lon], 10);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(state.mapInstance);

            // Add weather layer
            api.setMapLayer('temp');
        },

        updateTheme: () => {
            const isDark = state.settings.darkMode;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

            // Update meta theme-color
            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) {
                metaTheme.setAttribute('content', isDark ? '#0f172a' : '#f8fafc');
            }
        }
    };

    // ============================================
    // Map Layer Functions
    // ============================================
    api.setMapLayer = (layerType) => {
        if (!state.mapInstance) return;

        const apiKey = api.getApiKey();
        if (!apiKey) return;

        if (state.mapLayer) {
            state.mapInstance.removeLayer(state.mapLayer);
        }

        const layerMap = {
            temp: 'temp_new',
            precipitation: 'precipitation_new',
            clouds: 'clouds_new',
            wind: 'wind_new'
        };

        const layerName = layerMap[layerType] || 'temp_new';

        state.mapLayer = L.tileLayer(
            `${CONFIG.MAP_TILE_URL}/${layerName}/{z}/{x}/{y}.png?appid=${apiKey}`,
            { opacity: 0.6 }
        ).addTo(state.mapInstance);
    };

    // ============================================
    // App Logic
    // ============================================
    const app = {
        init: async () => {
            // Load settings
            const savedSettings = utils.storage.get('wp_settings');
            if (savedSettings) {
                state.settings = { ...state.settings, ...savedSettings };
            }

            // Load favorites
            state.favorites = utils.storage.get('wp_favorites', []);

            // Load recent searches
            state.recentSearches = utils.storage.get('wp_recent', []);

            // Apply theme
            ui.updateTheme();

            // Initialize weather animations
            weatherAnimations.init();

            // Setup event listeners
            app.setupEventListeners();

            // Check online status
            app.updateOnlineStatus();

            // Check for API key
            if (!api.getApiKey()) {
                utils.showToast('Please add your OpenWeather API key in Settings');
                // Load default demo data
                app.loadDemoData();
            } else {
                // Try to get location
                if (state.settings.autoLocation) {
                    app.getCurrentLocation();
                } else {
                    const savedCity = utils.storage.get('wp_current_city');
                    if (savedCity) {
                        app.loadCityWeather(savedCity);
                    } else {
                        app.loadCityWeather(CONFIG.DEFAULT_CITY);
                    }
                }
            }

            // Hide splash screen
            setTimeout(() => {
                $('#splash-screen').classList.add('hidden');
            }, 2500);

            // Setup periodic time update
            setInterval(() => {
                if (state.weatherData) {
                    $('#current-time').textContent = new Date().toLocaleTimeString('en-US', {
                        hour: '2-digit', minute: '2-digit', hour12: true
                    });
                }
            }, 60000);
        },

        setupEventListeners: () => {
            // Menu
            $('#menu-btn').addEventListener('click', () => app.toggleMenu(true));
            $('#close-menu').addEventListener('click', () => app.toggleMenu(false));
            $('.side-menu-overlay').addEventListener('click', () => app.toggleMenu(false));

            // Search
            $('#search-btn').addEventListener('click', () => app.toggleSearch(true));
            $('#close-search').addEventListener('click', () => app.toggleSearch(false));
            $('#search-input').addEventListener('input', utils.debounce((e) => {
                app.handleSearch(e.target.value);
            }, 500));
            $('#clear-search').addEventListener('click', () => {
                $('#search-input').value = '';
                $('#clear-search').classList.add('hidden');
                $('#search-results').innerHTML = '';
                $('#search-input').focus();
            });
            $('#locate-btn').addEventListener('click', () => {
                app.getCurrentLocation();
                app.toggleSearch(false);
            });

            // Navigation
            $$('.nav-item, .side-menu-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const page = link.dataset.page;
                    app.navigateTo(page);
                    app.toggleMenu(false);
                });
            });

            // Map layer buttons
            $$('.map-layer-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    $$('.map-layer-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    api.setMapLayer(btn.dataset.layer);
                });
            });

            // Settings toggles
            $('#dark-mode-toggle').addEventListener('change', (e) => {
                state.settings.darkMode = e.target.checked;
                ui.updateTheme();
                app.saveSettings();
            });

            $('#auto-dark-toggle').addEventListener('change', (e) => {
                state.settings.autoDark = e.target.checked;
                if (e.target.checked) app.checkAutoDark();
                app.saveSettings();
            });

            $('#alerts-toggle').addEventListener('change', (e) => {
                state.settings.alertsEnabled = e.target.checked;
                app.saveSettings();
            });

            $('#daily-forecast-toggle').addEventListener('change', (e) => {
                state.settings.dailyForecastEnabled = e.target.checked;
                app.saveSettings();
            });

            $('#hourly-toggle').addEventListener('change', (e) => {
                state.settings.hourlyEnabled = e.target.checked;
                app.saveSettings();
            });

            $('#auto-location-toggle').addEventListener('change', (e) => {
                state.settings.autoLocation = e.target.checked;
                app.saveSettings();
            });

            // Unit toggles
            $$('.unit-toggle[data-type="temp"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    $$('.unit-toggle[data-type="temp"]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.settings.tempUnit = btn.dataset.unit;
                    app.saveSettings();
                    if (state.weatherData) {
                        ui.renderCurrentWeather(state.weatherData);
                        ui.renderHourlyChart();
                        ui.renderHourlyList();
                        ui.renderDailyList();
                    }
                });
            });

            $$('.unit-toggle[data-type="wind"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    $$('.unit-toggle[data-type="wind"]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.settings.windUnit = btn.dataset.unit;
                    app.saveSettings();
                    if (state.weatherData) {
                        ui.renderCurrentWeather(state.weatherData);
                    }
                });
            });

            // API Key
            $('#api-key-input').addEventListener('change', (e) => {
                state.settings.apiKey = e.target.value.trim();
                app.saveSettings();
                utils.showToast('API key saved');
            });

            // Clear cache
            $('#clear-cache-btn').addEventListener('click', () => {
                utils.storage.remove('wp_weather_cache');
                utils.storage.remove('wp_current_city');
                utils.showToast('Cache cleared');
            });

            // Install prompt
            $('#install-dismiss').addEventListener('click', () => {
                $('#install-prompt').classList.add('hidden');
            });

            $('#install-btn').addEventListener('click', () => {
                if (state.deferredPrompt) {
                    state.deferredPrompt.prompt();
                    state.deferredPrompt.userChoice.then(() => {
                        state.deferredPrompt = null;
                        $('#install-prompt').classList.add('hidden');
                    });
                }
            });

            // Online/Offline
            window.addEventListener('online', () => app.updateOnlineStatus());
            window.addEventListener('offline', () => app.updateOnlineStatus());

            // Before install prompt
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                state.deferredPrompt = e;
                $('#install-prompt').classList.remove('hidden');
            });

            // App installed
            window.addEventListener('appinstalled', () => {
                $('#install-prompt').classList.add('hidden');
                state.deferredPrompt = null;
                utils.showToast('Weather Pluse+ installed!');
            });

            // Set initial settings values
            $('#dark-mode-toggle').checked = state.settings.darkMode;
            $('#auto-dark-toggle').checked = state.settings.autoDark;
            $('#alerts-toggle').checked = state.settings.alertsEnabled;
            $('#daily-forecast-toggle').checked = state.settings.dailyForecastEnabled;
            $('#hourly-toggle').checked = state.settings.hourlyEnabled;
            $('#auto-location-toggle').checked = state.settings.autoLocation;
            $('#api-key-input').value = state.settings.apiKey;

            // Set active unit toggles
            $$(`.unit-toggle[data-type="temp"][data-unit="${state.settings.tempUnit}"]`).forEach(b => b.classList.add('active'));
            $$(`.unit-toggle[data-type="temp"]:not([data-unit="${state.settings.tempUnit}"])`).forEach(b => b.classList.remove('active'));
            $$(`.unit-toggle[data-type="wind"][data-unit="${state.settings.windUnit}"]`).forEach(b => b.classList.add('active'));
            $$(`.unit-toggle[data-type="wind"]:not([data-unit="${state.settings.windUnit}"])`).forEach(b => b.classList.remove('active'));
        },

        toggleMenu: (show) => {
            const menu = $('#side-menu');
            if (show) menu.classList.add('open');
            else menu.classList.remove('open');
        },

        toggleSearch: (show) => {
            const overlay = $('#search-overlay');
            if (show) {
                overlay.classList.remove('hidden');
                $('#search-input').focus();
                ui.renderRecentSearches();
                ui.renderFavorites();
            } else {
                overlay.classList.add('hidden');
                $('#search-input').value = '';
                $('#search-results').innerHTML = '';
            }
        },

        navigateTo: (page) => {
            // Update nav items
            $$('.nav-item, .side-menu-link').forEach(item => {
                item.classList.toggle('active', item.dataset.page === page);
            });

            // Show page
            $$('.page').forEach(p => p.classList.remove('active'));
            const targetPage = $(`#page-${page}`);
            if (targetPage) targetPage.classList.add('active');

            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // Init map if maps page
            if (page === 'maps') {
                setTimeout(() => {
                    ui.initMap();
                    if (state.mapInstance) state.mapInstance.invalidateSize();
                }, 300);
            }
        },

        handleSearch: async (query) => {
            const clearBtn = $('#clear-search');
            if (query.length > 0) {
                clearBtn.classList.remove('hidden');
            } else {
                clearBtn.classList.add('hidden');
                $('#search-results').innerHTML = '';
                return;
            }

            if (query.length < 2) return;

            const results = await api.searchCity(query);
            ui.renderSearchResults(results);
        },

        getCurrentLocation: () => {
            if (!navigator.geolocation) {
                utils.showToast('Geolocation not supported');
                app.loadCityWeather(CONFIG.DEFAULT_CITY);
                return;
            }

            utils.showLoading(true);

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;

                    // Reverse geocode
                    const apiKey = api.getApiKey();
                    if (apiKey) {
                        try {
                            const response = await fetch(
                                `${CONFIG.GEO_API}/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${apiKey}`
                            );
                            const data = await response.json();
                            if (data && data[0]) {
                                const city = {
                                    name: data[0].name,
                                    lat: latitude,
                                    lon: longitude,
                                    country: data[0].country
                                };
                                app.loadCityWeather(city);
                            } else {
                                app.loadCityWeather({
                                    name: 'Current Location',
                                    lat: latitude,
                                    lon: longitude,
                                    country: ''
                                });
                            }
                        } catch (e) {
                            app.loadCityWeather({
                                name: 'Current Location',
                                lat: latitude,
                                lon: longitude,
                                country: ''
                            });
                        }
                    } else {
                        utils.showLoading(false);
                        utils.showToast('Please add API key in Settings');
                    }
                },
                (error) => {
                    utils.showLoading(false);
                    let message = 'Location error';
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            message = 'Location permission denied';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            message = 'Location unavailable';
                            break;
                        case error.TIMEOUT:
                            message = 'Location timeout';
                            break;
                    }
                    utils.showToast(message);
                    app.loadCityWeather(CONFIG.DEFAULT_CITY);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 600000 }
            );
        },

        loadCityWeather: async (city) => {
            state.currentCity = city;
            utils.storage.set('wp_current_city', city);

            const apiKey = api.getApiKey();
            if (!apiKey) {
                app.loadDemoData();
                return;
            }

            utils.showLoading(true);

            try {
                // Fetch all data in parallel
                const [currentData, forecastData, aqiData] = await Promise.all([
                    api.getCurrentWeather(city.lat, city.lon),
                    api.getForecast(city.lat, city.lon),
                    api.getAirQuality(city.lat, city.lon)
                ]);

                if (!currentData) {
                    utils.showToast('Failed to load weather data');
                    utils.showLoading(false);
                    return;
                }

                state.weatherData = currentData;

                if (forecastData) {
                    state.hourlyData = dataProcessor.processHourly(forecastData);
                    state.dailyData = dataProcessor.processDaily(forecastData);
                }

                // Render UI
                ui.renderCurrentWeather(currentData, aqiData);
                ui.renderHourlyChart();
                ui.renderHourlyList();
                ui.renderDailyList();
                ui.renderAlerts(currentData.alerts);

                // Cache data
                utils.storage.set('wp_weather_cache', {
                    city: city,
                    current: currentData,
                    hourly: state.hourlyData,
                    daily: state.dailyData,
                    aqi: aqiData,
                    timestamp: Date.now()
                });

            } catch (error) {
                console.error('Load weather error:', error);
                utils.showToast('Error loading weather data');

                // Try to load from cache
                const cached = utils.storage.get('wp_weather_cache');
                if (cached && cached.city.name === city.name) {
                    state.weatherData = cached.current;
                    state.hourlyData = cached.hourly || [];
                    state.dailyData = cached.daily || [];
                    ui.renderCurrentWeather(cached.current, cached.aqi);
                    ui.renderHourlyChart();
                    ui.renderHourlyList();
                    ui.renderDailyList();
                    utils.showToast('Showing cached data');
                }
            } finally {
                utils.showLoading(false);
            }
        },

        loadDemoData: () => {
            // Demo data for when no API key is available
            const demoCity = { name: 'Demo City', lat: 0, lon: 0, country: 'XX' };
            state.currentCity = demoCity;

            const demoCurrent = {
                main: {
                    temp: 293.15,
                    feels_like: 292.15,
                    temp_min: 288.15,
                    temp_max: 296.15,
                    humidity: 65,
                    pressure: 1013,
                    dew_point: 288.15
                },
                weather: [{ main: 'Clear', description: 'clear sky', icon: '01d' }],
                wind: { speed: 3.5, deg: 180 },
                clouds: { all: 10 },
                visibility: 10000,
                sys: { sunrise: Date.now()/1000 - 21600, sunset: Date.now()/1000 + 21600 },
                uvi: 5
            };

            state.weatherData = demoCurrent;
            state.hourlyData = Array.from({ length: 24 }, (_, i) => ({
                time: Date.now()/1000 + i * 3600,
                temp: 293.15 + Math.sin(i/3) * 5,
                feels_like: 292.15 + Math.sin(i/3) * 5,
                humidity: 60 + Math.random() * 20,
                windSpeed: 2 + Math.random() * 4,
                windDeg: 180 + Math.random() * 40,
                pop: Math.random() * 0.3,
                weather: { main: 'Clear', description: 'clear sky', icon: '01d' },
                visibility: 10000
            }));

            state.dailyData = Array.from({ length: 7 }, (_, i) => ({
                dt: Date.now()/1000 + i * 86400,
                tempMin: 288.15 + Math.random() * 3,
                tempMax: 296.15 + Math.random() * 3,
                tempAvg: 292.15,
                weather: { main: 'Clear', description: 'clear sky', icon: '01d' },
                pop: Math.random() * 0.2,
                humidity: 60 + Math.floor(Math.random() * 20),
                windSpeed: (2 + Math.random() * 4).toFixed(1),
                pressure: 1010 + Math.floor(Math.random() * 10)
            }));

            ui.renderCurrentWeather(demoCurrent, null);
            ui.renderHourlyChart();
            ui.renderHourlyList();
            ui.renderDailyList();
            utils.showLoading(false);
        },

        addRecentSearch: (city) => {
            // Remove if exists
            state.recentSearches = state.recentSearches.filter(r => r.name !== city.name);
            // Add to front
            state.recentSearches.unshift(city);
            // Limit
            if (state.recentSearches.length > CONFIG.MAX_RECENT) {
                state.recentSearches = state.recentSearches.slice(0, CONFIG.MAX_RECENT);
            }
            utils.storage.set('wp_recent', state.recentSearches);
        },

        toggleFavorite: (city) => {
            const index = state.favorites.findIndex(f => f.name === city.name && f.lat === city.lat);
            if (index >= 0) {
                state.favorites.splice(index, 1);
                utils.showToast(`${city.name} removed from favorites`);
            } else {
                if (state.favorites.length >= CONFIG.MAX_FAVORITES) {
                    utils.showToast('Max favorites reached');
                    return;
                }
                state.favorites.push(city);
                utils.showToast(`${city.name} added to favorites`);
            }
            utils.storage.set('wp_favorites', state.favorites);
            ui.renderFavorites();
        },

        removeFavorite: (cityName) => {
            state.favorites = state.favorites.filter(f => f.name !== cityName);
            utils.storage.set('wp_favorites', state.favorites);
            ui.renderFavorites();
            ui.renderRecentSearches();
            utils.showToast(`${cityName} removed from favorites`);
        },

        saveSettings: () => {
            utils.storage.set('wp_settings', state.settings);
        },

        updateOnlineStatus: () => {
            state.isOnline = navigator.onLine;
            const banner = $('#offline-banner');
            if (state.isOnline) {
                banner.classList.add('hidden');
            } else {
                banner.classList.remove('hidden');
                utils.showToast('You are offline');
            }
        },

        checkAutoDark: () => {
            if (!state.settings.autoDark) return;
            const hour = new Date().getHours();
            const isDark = hour < 6 || hour >= 18;
            state.settings.darkMode = isDark;
            $('#dark-mode-toggle').checked = isDark;
            ui.updateTheme();
        }
    };

    // ============================================
    // Initialize App
    // ============================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', app.init);
    } else {
        app.init();
    }

    // Expose app globally for inline handlers
    window.app = app;
    window.utils = utils;

})();