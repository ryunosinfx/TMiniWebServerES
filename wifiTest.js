// Import necessary modules
const network = require('network');
const wifi = require('pico_cyw43').PicoCYW43WIFI; // Driver is usually auto-registered

// Wi-Fi network credentials
const SSID = storage.getItem('WIFI_SSID');
const PASSWORD = storage.getItem('WIFI_PASSWORD');

const STATIC_IP = '192.168.2.112'; // The desired static IP address
const NETMASK = '255.255.255.0';
const GATEWAY = '192.168.2.1'; // The router's IP address
const DNS_SERVER = '8.8.8.8'; // A reliable DNS server (e.g., Google's)

async function connectWifiStatic() {
	console.log(`Connecting to Wi-Fi network: ${SSID}`);

	// Create a station network interface and activate it
	const wlan = network.WLAN(network.STA_IF);
	wlan.active(true);

	// Connect to the network using SSID and password
	wlan.connect(SSID, PASSWORD);

	// Wait for the connection to be established (initially via DHCP)
	let timeout = 10;
	while (timeout > 0 && wlan.status() !== 3) {
		console.log('Waiting for Wi-Fi connection...');
		await new Promise(resolve => setTimeout(resolve, 1000)); // Sleep for 1 second
		timeout--;
	}

	if (wlan.status() === 3) {
		console.log('Connection successful via DHCP, configuring static IP...');

		// Set the static IP configuration
		// The ifconfig() method takes a tuple/array of (ip, netmask, gateway, dns)
		wlan.ifconfig([STATIC_IP, NETMASK, GATEWAY, DNS_SERVER]);

		// Get and print the new network info to verify
		const network_info = wlan.ifconfig();
		console.log('Static IP address:', network_info[0]);
		console.log('Netmask:', network_info[1]);
		console.log('Gateway:', network_info[2]);
		console.log('DNS Server:', network_info[3]);
		console.log('Successfully set static IP');
	} else {
		console.log('Failed to establish a network connection');
		throw new Error('Network connection failed');
	}
}
connectWifiStatic;
