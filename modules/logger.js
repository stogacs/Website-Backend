const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const logTypes = ['error', 'transactions', 'events', 'purchases'];

function setupLog() {
	if (!fs.existsSync('./logs')) {
		fs.mkdirSync('./logs');
		logTypes.forEach((logtype) => {
			fs.mkdirSync(`./logs/${logtype}`);
		});
	} else {
		logTypes.forEach((logtype) => {
			if (!fs.existsSync(`./logs/${logtype}`)) {
				fs.mkdirSync(`./logs/${logtype}`);
			}
		});
	}
}

async function logToFile(logPath, logDetails) {
	const date = new Date();
	const dateString = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
	const timeString = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
	const logFile = `${logPath}/${dateString}.log`;
	const id = crypto.randomUUID();
	const logMessage = `[${timeString}] ID: ${id} | ${logDetails}\n`;
	if (!fs.existsSync(logPath)) {
		fs.mkdirSync(logPath);
	}
	fs.writeFileSync(logFile, logMessage, { flag: 'a+' });
	return id;
}

async function logError(error, user = null) {
	const userDetails = user ? `| Associated User: ${user.name} (${user.id})` : '';
	const logDetails = `Error: ${error} ${userDetails}`;

	return await logToFile('./logs/error', logDetails);
}

async function logTransaction(from, to, amount) {
	const logDetails = `Amount: ${amount} | Sender: ${from} | Recipient: ${to}`;

	return await logToFile('./logs/transactions', logDetails);
}

async function logPurchase(user, item, amount) {
	const userDetails = user ? `| Associated User: ${user.name} (${user.id})` : '';

	const logDetails = `Amount: ${amount} | User: ${userDetails} | Item: ${item.title} (${item.id}) | Price: ${item.price}`;

	return await logToFile('./logs/purchases', logDetails);
}

async function logEvent(event, user = null) {
	const userDetails = user ? `| Associated User: ${user.name} (${user.id})` : '';
	const logDetails = `Event: ${event} ${userDetails}`;

	return await logToFile('./logs/events', logDetails);
}

module.exports = { logError, logTransaction, logPurchase, logEvent, setupLog };
