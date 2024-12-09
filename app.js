require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

const app = express();
const port = 3000; // Puerto fijo

app.use(express.json()); // Reemplazo de bodyParser para manejar JSON

// Función para realizar solicitudes con Puppeteer
async function fetchWithPuppeteer(url) {
    const browser = await puppeteer.launch({
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
    const page = await browser.newPage();

    try {
        await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
        const bodyText = await page.evaluate(() => document.body.innerText);
        return JSON.parse(bodyText); // Convertir la respuesta en JSON
    } catch (error) {
        console.error(`Error en Puppeteer al cargar ${url}:`, error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

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

// Nuevo endpoint para verificar la existencia de una partida
app.post('/verification', async (req, res) => {
    console.log('Received verification request:', req.body);
    const { lat, lng } = req.body;

    try {
        const result = await verifyProperty(lat, lng);
        console.log(result.message); // Log para indicar si la partida existe o no
        res.send(result);
    } catch (error) {
        console.error('Error en la verificación:', error);
        res.status(500).send({ error: 'Error verificando la existencia de la partida' });
    }
});

// Verificar propiedad usando Puppeteer
async function verifyProperty(lat, lng) {
    try {
        console.log(`Verificando propiedad en lat: ${lat}, lng: ${lng}`);
        const baseUrl = `https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`;
        const data = await fetchWithPuppeteer(baseUrl);

        if (data.propiedad_horizontal === "Si") {
            console.log('Propiedad horizontal detectada. Verificando unidades funcionales...');
            const phData = await fetchWithPuppeteer(`${baseUrl}&ph`);
            if (phData.phs && phData.phs.length > 0) {
                return { message: 'La partida existe', phs: phData.phs };
            } else {
                return { message: 'La partida no existe (sin unidades funcionales)' };
            }
        } else if (data.pdamatriz) {
            const pdamatriz = data.pdamatriz;
            console.log(`Número de partida matriz obtenido: ${pdamatriz}`);
            return { message: 'La partida existe', pdamatriz };
        }

        return { message: 'La partida no existe' };
    } catch (error) {
        console.error('Error verificando propiedad:', error.message);
        throw error;
    }
}

// Obtener datos de ABL usando Puppeteer
async function fetchAblData(lat, lng) {
    try {
        console.log(`Obteniendo datos de ABL para lat: ${lat}, lng: ${lng}`);
        const baseUrl = `https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`;
        const data = await fetchWithPuppeteer(baseUrl);

        if (data.propiedad_horizontal === "Si") {
            console.log('Propiedad horizontal detectada. Obteniendo datos adicionales...');
            const phData = await fetchWithPuppeteer(`${baseUrl}&ph`);
            return phData.phs ? phData.phs.map(ph => ({
                pdahorizontal: ph.pdahorizontal,
                piso: ph.piso,
                dpto: ph.dpto
            })) : null;
        } else if (data.pdamatriz) {
            return data.pdamatriz;
        }

        console.error('No se encontraron datos válidos.');
        return null;
    } catch (error) {
        console.error('Error obteniendo datos de ABL:', error.message);
        throw error;
    }
}

// Enviar email
async function sendEmail(email, data) {
    let transporter = nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.BREVO_USER,
            pass: process.env.BREVO_PASS,
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    const dataText = Array.isArray(data)
        ? data.map(d => `Partida: ${d.pdahorizontal}, Piso: ${d.piso}, Dpto: ${d.dpto}`).join('\n')
        : `Partida matriz: ${data}`;

    const mailOptions = {
        from: '"PROPROP" <ricardo@proprop.com.ar>',
        to: email,
        subject: "Consulta de ABL",
        text: dataText,
        html: `<p>${dataText.replace(/\n/g, '<br>')}</p>`
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Correo enviado:', info.messageId);
    } catch (error) {
        console.error('Error enviando correo:', error.message);
        throw error;
    }
}

const server = app.listen(port, () => {
    console.log(`Servidor ejecutándose en el puerto ${port}`);
});

server.setTimeout(15000); // Reducido de 60s a 15s