require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

const app = express();
const port = 3000;

// Instancia compartida de Puppeteer
let browser;

async function startBrowser() {
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote'
        ],
    });
    console.log('Navegador Puppeteer iniciado.');
}

async function stopBrowser() {
    if (browser) {
        await browser.close();
        console.log('Navegador Puppeteer cerrado.');
    }
}

// Función para solicitudes
async function fetchWithPuppeteer(url) {
    const page = await browser.newPage();
    try {
        await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
        const bodyText = await page.evaluate(() => document.body.innerText);

        try {
            return JSON.parse(bodyText);
        } catch (error) {
            console.error(`Error parseando JSON desde ${url}:`, error.message);
            console.error('Contenido recibido (primeros 500 caracteres):', bodyText.slice(0, 500));
            throw new Error('La API no devolvió una respuesta JSON válida.');
        }
    } catch (error) {
        console.error(`Error en Puppeteer al cargar ${url}:`, error.message);
        throw error;
    } finally {
        await page.close();
    }
}

app.use(express.json());

// ... tus funciones fetchAblData, verifyProperty, sendEmail se mantienen IGUALES ...

// Endpoint para obtener datos de ABL y enviar email
app.post('/fetch-abl-data', async (req, res) => {
    console.log('Received data:', req.body);
    const { lat, lng, email } = req.body;

    try {
        const pdamatriz = await fetchAblData(lat, lng);
        if (pdamatriz) {
            await sendEmail(email, pdamatriz);
            console.log('Email sent with data:', { pdamatriz });
            res.send({ message: 'Email enviado con éxito', pdamatriz });
        } else {
            console.error('No se pudo obtener el número de partida matriz o datos de propiedad horizontal.');
            res.status(500).send({ error: 'No se pudo obtener el número de partida matriz o datos de propiedad horizontal.' });
        }
    } catch (error) {
        console.error('Error en el proceso:', error);
        res.status(500).send({ error: 'Error procesando la solicitud' });
    }
});

// Endpoint para verificar la existencia de una partida
app.post('/verification', async (req, res) => {
    console.log('Received verification request:', req.body);
    const { lat, lng } = req.body;

    try {
        const result = await verifyProperty(lat, lng);
        console.log(result.message);
        res.send(result);
    } catch (error) {
        console.error('Error en la verificación:', error);
        res.status(500).send({ status: 'error', message: 'Error verificando la existencia de la partida' });
    }
});

// Inicializar navegador y servidor
startBrowser()
    .then(() => {
        const server = app.listen(port, () => {
            console.log(`Servidor ejecutándose en el puerto ${port}`);
        });

        server.setTimeout(20000); // 20 segundos

        // Manejar cierre correcto del navegador al apagar servidor
        process.on('SIGINT', async () => {
            console.log('Apagando servidor...');
            await stopBrowser();
            process.exit();
        });
    })
    .catch(error => {
        console.error('Error iniciando Puppeteer:', error.message);
        process.exit(1);
    });