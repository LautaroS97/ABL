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
            console.error('No se pudo obtener el número de partida matriz.');
            res.status(500).send({ error: 'No se pudo obtener el número de partida matriz.' });
        }
    } catch (error) {
        console.error('Error en el proceso:', error);
        res.status(500).send({ error: 'Error procesando la solicitud' });
    }
});

async function fetchAblData(lat, lng) {
    try {
        console.log(`Fetching ABL data for coordinates: ${lat}, ${lng}`);
        const response = await axios.get(`https://epok.buenosaires.gob.ar/catastro/parcela/?lng=${lng}&lat=${lat}`);

        if (response.data && response.data.pdamatriz) {
            const pdamatriz = response.data.pdamatriz;
            console.log('Número de partida matriz obtenido:', pdamatriz);
            return pdamatriz;
        } else {
            console.error('No se encontró el número de partida matriz en la respuesta.');
            return null;
        }
    } catch (error) {
        console.error('Error obteniendo datos de ABL:', error);
        throw error;
    }
}

async function sendEmail(email, pdamatriz) {
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
        text: `El número de partida matriz es:\n${pdamatriz}\n\nTe llegó este correo porque solicitaste tu número de partida matriz al servicio de consultas de ProProp.`,
        html: `
            <div style="padding: 1rem; text-align: center;">
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/Logo-email.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p>El número de partida matriz es:<br><b>${pdamatriz}</b></p><hr>
                <p>Puede utilizar esta información para realizar consultas adicionales en la AGIP.</p>
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/20240619_194805-min.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;">Te llegó este correo porque solicitaste tu número de partida matriz al servicio de consultas de ProProp.</p>
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;"><b>Ante cualquier duda, puede responder este correo.</b></p>
            </div>
        `
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