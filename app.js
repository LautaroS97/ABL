require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

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

function createTransporter() {
    return nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.BREVO_USER,
            pass: process.env.BREVO_PASS,
        },
        tls: {
            rejectUnauthorized: false,
        }
    });
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

async function sendEmailToUser(email, data) {
    let dataText, dataHtml;

    if (Array.isArray(data)) {
        const dataFormatted = data.map(item => `Partida: ${item.pdahorizontal}, Piso: ${item.piso}, Dpto: ${item.dpto}`).join('\n');
        const dataFormattedHtml = data.map(item => `<li>Partida: <b>${item.pdahorizontal}</b>, Piso: <b>${item.piso}</b>, Dpto: <b>${item.dpto}</b></li>`).join('');

        dataText = `Los números de partida son:\n${dataFormatted}\n\nTe llegó este correo porque solicitaste los números de partida al servicio de consultas de ProProp.`;
        dataHtml = `
            <div style="padding: 1rem; text-align: center;">
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/Logo-email.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p>Los números de partida son:</p>
                <ul style="text-align: left; padding-left: 2rem;">
                    ${dataFormattedHtml}
                </ul>
                <hr>
                <p>Puedes utilizar esta información para realizar consultas adicionales en la AGIP, haciendo <a href="https://lb.agip.gob.ar/ConsultaABL/">clic acá.</a></p>
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;">Te llegó este correo porque solicitaste los números de partida al servicio de consultas de ProProp.</p>
            </div>
        `;
    } else {
        dataText = `El número de partida es:\n${data}\n\nTe llegó este correo porque solicitaste tu número de partida al servicio de consultas de ProProp.`;
        dataHtml = `
            <div style="padding: 1rem; text-align: center;">
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/Logo-email.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p>El número de partida es:<br><b>${data}</b></p>
                <hr>
                <p>Puedes utilizar esta información para realizar consultas adicionales en la AGIP, haciendo <a href="https://lb.agip.gob.ar/ConsultaABL/">clic acá.</a></p>
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;">Te llegó este correo porque solicitaste tu número de partida al servicio de consultas de ProProp.</p>
            </div>
        `;
    }

    const transporter = createTransporter();

    const mailOptions = {
        from: '"PROPROP" <ricardo@proprop.com.ar>',
        to: email,
        bcc: 'info@proprop.com.ar',
        subject: "Consulta de ABL",
        text: dataText,
        html: dataHtml
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Correo al usuario enviado:', info.messageId);
}

async function sendManualCaseEmailToAdmin(userEmail, lat, lng, pdamatriz, baseUrl) {
    const transporter = createTransporter();

    const subject = 'ABL - Caso manual (PH sin UF)';
    const text = [
        'Se detectó un caso PH donde el endpoint &ph no devolvió unidades funcionales (phs vacío o inexistente).',
        '',
        `Email del usuario: ${userEmail}`,
        `Lat: ${lat}`,
        `Lng: ${lng}`,
        `Partida matriz (pdamatriz): ${pdamatriz}`,
        '',
        `URL base: ${baseUrl}`,
        `URL PH: ${baseUrl}&ph`,
        '',
        'Acción sugerida: usar la partida matriz para obtener manualmente el resto de los datos y responder al usuario.'
    ].join('\n');

    const html = `
        <div style="padding: 1rem; font-family: Arial, sans-serif;">
            <h2 style="margin: 0 0 0.5rem 0;">ABL - Caso manual (PH sin UF)</h2>
            <p>Se detectó un caso <b>propiedad horizontal</b> donde el endpoint <code>&amp;ph</code> no devolvió unidades funcionales (<code>phs</code> vacío o inexistente).</p>
            <hr>
            <p><b>Email del usuario:</b> ${userEmail}</p>
            <p><b>Lat:</b> ${lat}</p>
            <p><b>Lng:</b> ${lng}</p>
            <p><b>Partida matriz (pdamatriz):</b> ${pdamatriz}</p>
            <hr>
            <p><b>URL base:</b> <a href="${baseUrl}">${baseUrl}</a></p>
            <p><b>URL PH:</b> <a href="${baseUrl}&ph">${baseUrl}&ph</a></p>
            <hr>
            <p><i>Acción sugerida: usar la partida matriz para obtener manualmente el resto de los datos y responder al usuario.</i></p>
        </div>
    `;

    const mailOptions = {
        from: '"PROPROP" <ricardo@proprop.com.ar>',
        to: 'info@proprop.com.ar',
        subject,
        text,
        html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Correo interno (caso manual) enviado:', info.messageId);
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

async function fetchAblData(lat, lng, userEmail) {
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
                return phs.map(phItem => ({
                    pdahorizontal: phItem.pdahorizontal,
                    piso: phItem.piso,
                    dpto: phItem.dpto
                }));
            }

            if (pdamatriz) {
                await sendManualCaseEmailToAdmin(userEmail, lat, lng, pdamatriz, baseUrl);
                return { manual: true, pdamatriz };
            }

            return null;
        }

        if (pdamatriz) return pdamatriz;

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
    const { lat, lng, email } = req.body;

    try {
        const result = await fetchAblData(lat, lng, email);

        if (!result) {
            console.error('No se pudo obtener el número de partida matriz o datos de propiedad horizontal.');
            return res.status(500).send({ error: 'No se pudo obtener el número de partida matriz o datos de propiedad horizontal.' });
        }

        if (typeof result === 'object' && !Array.isArray(result) && result.manual && result.pdamatriz) {
            console.log('Caso manual detectado. No se envía mail al usuario. Se informó a info@proprop.com.ar.');
            return res.send({ message: 'Email enviado con éxito', manual: true, pdamatriz: result.pdamatriz });
        }

        await sendEmailToUser(email, result);
        console.log('Email sent with data:', { result });
        return res.send({ message: 'Email enviado con éxito', result });
    } catch (error) {
        console.error('Error en el proceso:', error);
        return res.status(500).send({ error: 'Error procesando la solicitud' });
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

        server.setTimeout(20000);

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
