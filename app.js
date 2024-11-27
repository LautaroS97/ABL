require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');

const app = express();
const port = 3000; // Puerto fijo

app.use(helmet());
app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());

app.options('*', cors());

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

async function verifyProperty(lat, lng) {
    try {
        console.log(`Verifying property existence for coordinates: ${lat}, ${lng}`);
        const baseUrl = `https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`;
        let response = await axios.get(baseUrl);

        if (response.data) {
            if (response.data.propiedad_horizontal === "Si") {
                console.log('Propiedad horizontal detectada. Verificando unidades funcionales...');
                response = await axios.get(`${baseUrl}&ph`);
                if (response.data && response.data.phs && response.data.phs.length > 0) {
                    console.log('La partida existe (propiedad horizontal).');
                    return { message: 'La partida existe', phs: response.data.phs };
                } else {
                    console.log('La partida no existe (propiedad horizontal sin unidades).');
                    return { message: 'La partida no existe' };
                }
            } else if (response.data.pdamatriz) {
                const pdamatriz = response.data.pdamatriz;
                console.log('Número de partida matriz obtenido:', pdamatriz);

                try {
                    const debtUrl = `https://lb.agip.gob.ar/ConsultaABL/comprobante/ESTADO-DEUDA-ABL-734456.pdf?boletasSeleccionadas=&identificadorPDF=${pdamatriz}&dvPDF=4&fechaInicioPDF=`;
                    const debtResponse = await axios.get(debtUrl, { responseType: 'text' });

                    // Verificar si la respuesta contiene el "statusCode": 402
                    if (debtResponse.data.includes('"statusCode":402')) {
                        console.log('La partida no existe (statusCode 402 detectado).');
                        return { message: 'La partida no existe' };
                    } else {
                        console.log('La partida existe (statusCode 402 no detectado).');
                        return { message: 'La partida existe', pdamatriz: pdamatriz };
                    }
                } catch (error) {
                    console.error('Error accediendo al URL de deuda:', error);
                    throw error;
                }
            }
            console.log('La partida no existe (respuesta sin pdamatriz ni phs).');
            return { message: 'La partida no existe' };
        } else {
            console.error('Respuesta vacía o sin formato esperado en la verificación.');
            return { error: 'Respuesta vacía o sin formato esperado en la verificación.' };
        }
    } catch (error) {
        console.error('Error verificando la propiedad:', error);
        throw error;
    }
}

async function fetchAblData(lat, lng) {
    try {
        console.log(`Fetching ABL data for coordinates: ${lat}, ${lng}`);
        const baseUrl = `https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`;
        let response = await axios.get(baseUrl);

        if (response.data) {
            console.log('Respuesta obtenida:', response.data);
            
            // Verificar si la propiedad es horizontal
            if (response.data.propiedad_horizontal === "Si") {
                console.log('Propiedad horizontal detectada. Solicitando datos adicionales con &ph...');
                response = await axios.get(`${baseUrl}&ph`);

                if (response.data && response.data.phs) {
                    const pdahorizontals = response.data.phs.map(ph => ({
                        pdahorizontal: ph.pdahorizontal,
                        piso: ph.piso,
                        dpto: ph.dpto
                    }));
                    console.log('Valores de pdahorizontal obtenidos:', pdahorizontals);
                    return pdahorizontals; // Devuelve el array de objetos con pdahorizontal, piso y dpto
                } else {
                    console.error('No se encontraron valores de pdahorizontal en la respuesta.');
                    return null;
                }
            } else if (response.data.pdamatriz) {
                const pdamatriz = response.data.pdamatriz;
                console.log('Número de partida matriz obtenido:', pdamatriz);
                return pdamatriz; // Devuelve el número de partida matriz si no es horizontal
            } else {
                console.error('No se encontró el número de partida matriz en la respuesta.');
                return null;
            }
        } else {
            console.error('Respuesta vacía o sin formato esperado.');
            return null;
        }
    } catch (error) {
        console.error('Error obteniendo datos de ABL:', error);
        throw error;
    }
}

async function sendEmail(email, data) {
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
                </ul><hr>
                <p>Puede utilizar esta información para realizar consultas adicionales en la AGIP, haciendo <a href="https://lb.agip.gob.ar/ConsultaABL/">clic acá.</a></p>
                <img src="https://proprop.com.ar/wp-content/uploads/2024/11/ABL-2.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;">Te llegó este correo porque solicitaste los números de partida al servicio de consultas de ProProp.</p>
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;"><b>Ante cualquier duda, puede responder este correo.</b></p>
            </div>
        `;
    } else {
        dataText = `El número de partida  es:\n${data}\n\nTe llegó este correo porque solicitaste tu número de partida al servicio de consultas de ProProp.`;
        dataHtml = `
            <div style="padding: 1rem; text-align: center;">
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/Logo-email.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p>El número de partida es:<br><b>${data}</b></p><hr>
                <p>Puede utilizar esta información para realizar consultas adicionales en la AGIP, haciendo <a href="https://lb.agip.gob.ar/ConsultaABL/">clic acá.</a></p>
                <img src="https://proprop.com.ar/wp-content/uploads/2024/11/ABL-2.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;">Te llegó este correo porque solicitaste tu número de partida al servicio de consultas de ProProp.</p>
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;"><b>Ante cualquier duda, puede responder este correo.</b></p>
            </div>
        `;
    }

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
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
    });

    let mailOptions = {
        from: '"PROPROP" <ricardo@proprop.com.ar>',
        to: email,
        bcc: 'info@proprop.com.ar',
        subject: "Consulta de ABL",
        text: dataText,
        html: dataHtml
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log('Message sent: %s', info.messageId);
    } catch (error) {
        console.error('Error enviando email:', error);
        throw error;
    }
}

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

server.setTimeout(10000);