require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = 3000;

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

function isPropiedadHorizontal(value) {
    if (value === null || value === undefined) return false;
    const v = String(value).trim().toLowerCase();
    return v !== 'no';
}

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

async function verifyProperty(lat, lng) {
    try {
        console.log(`Verificando propiedad en lat: ${lat}, lng: ${lng}`);
        const baseUrl = `https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`;
        const data = await fetchWithPuppeteer(baseUrl);

        const ph = isPropiedadHorizontal(data.propiedad_horizontal);
        const pdamatriz = data.pdamatriz || null;

        if (ph) {
            console.log('Propiedad horizontal detectada. Verificando unidades funcionales...');
            const phData = await fetchWithPuppeteer(`${baseUrl}&ph`);
            const phs = Array.isArray(phData.phs) ? phData.phs : [];

            if (phs.length > 0) {
                return { status: 'success', message: 'La partida existe', phs };
            }

            if (pdamatriz) {
                return { status: 'success', message: 'La partida existe', pdamatriz, manual: true, reason: 'PH_EMPTY' };
            }

            return { status: 'error', message: 'La partida no existe (sin unidades funcionales)' };
        }

        if (pdamatriz) {
            console.log(`Número de partida matriz obtenido: ${pdamatriz}`);
            return { status: 'success', message: 'La partida existe', pdamatriz };
        }

        return { status: 'error', message: 'La partida no existe' };
    } catch (error) {
        console.error('Error verificando propiedad:', error.message);
        throw error;
    }
}

async function fetchAblData(lat, lng) {
    try {
        console.log(`Obteniendo datos de ABL para lat: ${lat}, lng: ${lng}`);
        const baseUrl = `https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`;
        const data = await fetchWithPuppeteer(baseUrl);

        const ph = isPropiedadHorizontal(data.propiedad_horizontal);
        const pdamatriz = data.pdamatriz || null;

        if (ph) {
            console.log('Propiedad horizontal detectada. Obteniendo datos adicionales...');
            const phData = await fetchWithPuppeteer(`${baseUrl}&ph`);
            const phs = Array.isArray(phData.phs) ? phData.phs : [];

            if (phs.length > 0) {
                return {
                    type: 'horizontal_property',
                    partidas: phs.map(phItem => ({
                        pdahorizontal: phItem.pdahorizontal,
                        piso: phItem.piso,
                        dpto: phItem.dpto
                    }))
                };
            }

            if (pdamatriz) {
                return {
                    type: 'manual_review',
                    manual: true,
                    reason: 'PH_EMPTY',
                    pdamatriz,
                    baseUrl,
                    phUrl: `${baseUrl}&ph`
                };
            }

            return null;
        }

        if (pdamatriz) {
            return {
                type: 'single',
                pdamatriz
            };
        }

        console.error('No se encontraron datos válidos.');
        return null;
    } catch (error) {
        console.error('Error obteniendo datos de ABL:', error.message);
        throw error;
    }
}

app.use(express.json());

app.post('/fetch-abl-data', async (req, res) => {
    console.log('Received data:', req.body);
    const { lat, lng, email, address } = req.body;

    try {
        const result = await fetchAblData(lat, lng);

        if (!result) {
            console.error('No se pudo obtener el número de partida matriz o datos de propiedad horizontal.');
            return res.status(500).send({
                success: false,
                service: 'abl',
                error: 'No se pudo obtener el número de partida matriz o datos de propiedad horizontal.',
                email,
                address,
                lat,
                lng
            });
        }

        const response = {
            success: true,
            service: 'abl',
            message: 'Datos ABL obtenidos correctamente',
            result,
            email,
            address,
            lat,
            lng
        };

        if (result.manual) {
            response.message = 'Caso manual detectado';
            response.manual = true;
            response.reason = result.reason;
            response.pdamatriz = result.pdamatriz;
            response.baseUrl = result.baseUrl;
            response.phUrl = result.phUrl;
        }

        if (result.type === 'horizontal_property') {
            response.partidas = result.partidas;
        }

        if (result.type === 'single') {
            response.pdamatriz = result.pdamatriz;
            response.partidas = result.pdamatriz;
        }

        console.log('Datos ABL obtenidos correctamente:', { result });
        return res.send(response);
    } catch (error) {
        console.error('Error en el proceso:', error);
        return res.status(500).send({
            success: false,
            service: 'abl',
            error: 'Error procesando la solicitud',
            details: error.message || String(error),
            email,
            address,
            lat,
            lng
        });
    }
});

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

startBrowser()
    .then(() => {
        const server = app.listen(port, () => {
            console.log(`Servidor ejecutándose en el puerto ${port}`);
        });

        server.setTimeout(60000);

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
