// ---------------------- EFFETTO NEVE

document.addEventListener("DOMContentLoaded", function () {
    const snowContainer = document.querySelector(".snow-container");

    const particlesPerThousandPixels = 0.1;
    const fallSpeed = 1;
    const pauseWhenNotActive = true;
    const maxSnowflakes = 200;
    const snowflakes = [];

    let snowflakeInterval;
    let isTabActive = true;

    function resetSnowflake(snowflake) {
        const size = Math.random() * 6 + 1;
        const viewportWidth = window.innerWidth - size; // Dimensione fiocchi
        const viewportHeight = window.innerHeight;

        snowflake.style.width = `${size}px`;
        snowflake.style.height = `${size}px`;
        snowflake.style.left = `${Math.random() * viewportWidth}px`;
        snowflake.style.top = `-${size}px`;

        const animationDuration = (Math.random() * 3 + 2) / fallSpeed;
        snowflake.style.animationDuration = `${animationDuration}s`;
        snowflake.style.animationTimingFunction = "linear";
        snowflake.style.animationName =
            Math.random() < 0.5 ? "fall" : "diagonal-fall";

        setTimeout(() => {
            if (parseInt(snowflake.style.top, 10) < viewportHeight) {
                resetSnowflake(snowflake);
            } else {
                snowflake.remove();
            }
        }, animationDuration * 1000);
    }

    function createSnowflake() {
        if (snowflakes.length < maxSnowflakes) {
            const snowflake = document.createElement("div");
            snowflake.classList.add("snowflake");
            snowflakes.push(snowflake);
            snowContainer.appendChild(snowflake);
            resetSnowflake(snowflake);
        }
    }

    function generateSnowflakes() {
        const numberOfParticles =
            Math.ceil((window.innerWidth * window.innerHeight) / 1000) *
            particlesPerThousandPixels;
        const interval = 5000 / numberOfParticles;

        clearInterval(snowflakeInterval);
        snowflakeInterval = setInterval(() => {
            if (isTabActive && snowflakes.length < maxSnowflakes) {
                requestAnimationFrame(createSnowflake);
            }
        }, interval);
    }

    function handleVisibilityChange() {
        if (!pauseWhenNotActive) return;

        isTabActive = !document.hidden;
        if (isTabActive) {
            generateSnowflakes();
        } else {
            clearInterval(snowflakeInterval);
        }
    }

    generateSnowflakes();

    window.addEventListener("resize", () => {
        clearInterval(snowflakeInterval);
        setTimeout(generateSnowflakes, 1000);
    });

    document.addEventListener("visibilitychange", handleVisibilityChange);
});

// ---------------------- EFFETTO NEVE END


// ---------------------- TOGGLE NEVE

const snowContainer = document.querySelector('.snow-container');

// La variabile snowPreference esiste se nel localstorage snow=false
const snowPreference = localStorage.getItem('snow') === 'false';

// Se snowPreference non esiste vuol dire che la neve è accesa perché non è stata impostata su false
if (!snowPreference) {
    snowContainer.style.display = 'block'; // Mostra il div della neve
} else {
    snowContainer.style.display = 'none'; // Nascondi il div della neve
}

// Modifica la posizione del toggle a seconda della variabile snowPreference
const toggleSnow = document.getElementById('toggleSnow');
toggleSnow.checked = !snowPreference; // acceso quando la variabile snowPreference è "non falsa"

// Ascolta modifiche al toggle e salva di conseguenza nel localstorage
toggleSnow.addEventListener('change', () => {
    if (toggleSnow.checked) {
        snowContainer.style.display = 'block';
        localStorage.setItem('snow', 'true');
    } else {
        snowContainer.style.display = 'none';
        localStorage.setItem('snow', 'false');
    }
});

// ---------------------- TOGGLE NEVE END


// ---------------------- CHECK VOTI GAME AWARDS

document.addEventListener('DOMContentLoaded', () => {
    const gameAwardsForm = document.querySelector('#gameAwardsForm');
    const communityAwardsForm = document.querySelector('#communityAwardsForm');
    // Esegui solo se esiste il form nella pagina
    if (gameAwardsForm) initGameAwardsPage(gameAwardsForm);
    if (communityAwardsForm) initCommunityAwardsPage(communityAwardsForm);
});

function initGameAwardsPage(form) {
    const categories = JSON.parse(form.dataset.categories);
    const errorMessage = document.getElementById('voteError');

    form.addEventListener('submit', (e) => {
        errorMessage.style.display = 'none';
        errorMessage.classList.remove('fade');

        for (const cat of categories) {
            const selected = form.querySelector(`input[name="${cat}"]:checked`);
            if (!selected) {
                e.preventDefault();
                errorMessage.style.display = 'block';
                errorMessage.classList.remove('fade');
                errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => errorMessage.classList.add('fade'), 3000);
                return;
            }
        }
    });
}

function initCommunityAwardsPage(form) {
    const categories = JSON.parse(form.dataset.categories);
    const errorMessage = document.getElementById('voteError');

    form.addEventListener('submit', (e) => {
        errorMessage.style.display = 'none';
        errorMessage.classList.remove('fade');

        for (const cat of categories) {
            const selected = form.querySelector(`input[name="${cat}"]:checked`);
            if (!selected) {
                e.preventDefault();
                errorMessage.style.display = 'block';
                errorMessage.classList.remove('fade');
                errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => errorMessage.classList.add('fade'), 3000);
                return;
            }
        }
    });
}

// ---------------------- CHECK VOTI GAME AWARDS END