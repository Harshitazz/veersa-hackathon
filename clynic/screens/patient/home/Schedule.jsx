import React, { useState, useEffect, useCallback } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Alert,
    Platform,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import * as ExpoCalendar from "expo-calendar";
import { Calendar as RNCalendar } from "react-native-calendars";
import axios from "axios";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Linking from 'expo-linking';


const AppointmentBooking = () => {
    const route = useRoute();
    const { doctor } = route.params;
    const parsedDoctor = JSON.parse(doctor);

    const [selectedDate, setSelectedDate] = useState("");
    const [bookedSlots, setBookedSlots] = useState([]);
    const [loading, setLoading] = useState(false);
    const [slotsFetched, setSlotsFetched] = useState(false);
    const [calendarId, setCalendarId] = useState(null);

    // request calender permisions to proceed with appointment booking
    useEffect(() => {
        (async () => {
            const { status } =
                await ExpoCalendar.requestCalendarPermissionsAsync();
            if (status === "granted") {
                const calendars = await ExpoCalendar.getCalendarsAsync(
                    ExpoCalendar.EntityTypes.EVENT
                );

                const existingCalendar = calendars.find(
                    (cal) => cal.title === "Expo Calendar"
                );
                if (existingCalendar) {
                    setCalendarId(existingCalendar.id);
                } else {
                    const newCalendarId = await createCalendar();
                    setCalendarId(newCalendarId);
                }
            } else {
                Alert.alert(
                    "Permission Denied",
                    "Calendar access is required to manage appointments."
                );
            }

            //request  for notification permission
            setNotificationHandler();
            await registerForPushNotificationsAsync();

        })();
    }, []);

    // create the calender
    const createCalendar = async () => {
        const defaultCalendarSource =
            Platform.OS === "ios"
                ? await getDefaultCalendarSource()
                : { isLocalAccount: true, name: "Expo Calendar" };

        const newCalendarID = await ExpoCalendar.createCalendarAsync({
            title: "Expo Calendar",
            color: "blue",
            entityType: ExpoCalendar.EntityTypes.EVENT,
            sourceId: defaultCalendarSource.id,
            source: defaultCalendarSource,
            name: "internalCalendarName",
            ownerAccount: "personal",
            accessLevel: ExpoCalendar.CalendarAccessLevel.OWNER,
        });
        return newCalendarID;
    };

    const getDefaultCalendarSource = async () => {
        const defaultCalendar = await ExpoCalendar.getDefaultCalendarAsync();
        return defaultCalendar.source;
    };

    // function that finds all slots for that particular doctor on that particular date, this ensures that we do not show slots that have already been booked.
    const fetchBookedSlots = useCallback(async () => {
        try {
            const response = await axios.get(
                `${process.env.EXPO_PUBLIC_BACKED_API_URL}/appointment/check-availability`,
                {
                    params: {
                        doctor_id: parsedDoctor._id,
                        date: selectedDate,
                    },
                }
            );
            const data = response.data;
            let temp = data.map((item) => item.timeSlot);
            setBookedSlots(temp || []);
            setSlotsFetched(true);
        } catch (error) {
            console.error("Error fetching booked slots:", error);
            Alert.alert("Error", "Failed to fetch booked slots.");
        } finally {
            setLoading(false);
        }
    }, [selectedDate, parsedDoctor._id]);

    // call the fetchBookedSlots function everytime the date is changed
    useEffect(() => {
        if (selectedDate) {
            setLoading(true);
            setSlotsFetched(false);
            fetchBookedSlots();
        }
    }, [selectedDate, fetchBookedSlots]);

    // function that generates slots for a particular date, by default we provide slots from 9 to 12, and 3 to 5.
    // this function ensures we do not show the booked slots to users
    const generateSlots = () => {
        const slots = [];
        const timeRanges = [
            { start: "09:00", end: "12:00" },
            { start: "15:00", end: "17:00" },
        ];

        timeRanges.forEach(({ start, end }) => {
            let [startHour, startMinute] = start.split(":").map(Number);
            let [endHour, endMinute] = end.split(":").map(Number);

            while (
                startHour < endHour ||
                (startHour === endHour && startMinute < endMinute)
            ) {
                const slotTime = `${startHour
                    .toString()
                    .padStart(2, "0")}:${startMinute
                    .toString()
                    .padStart(2, "0")}`;
                const formattedSlot = `${slotTime}-${
                    startMinute + 30 >= 60
                        ? (startHour + 1).toString().padStart(2, "0")
                        : startHour.toString().padStart(2, "0")
                }:${
                    (startMinute + 30) % 60 === 0
                        ? "00"
                        : (startMinute + 30).toString().padStart(2, "0")
                }`;
                if (!bookedSlots.includes(formattedSlot)) {
                    slots.push(formattedSlot);
                }
                startMinute += 30;
                if (startMinute >= 60) {
                    startMinute = 0;
                    startHour += 1;
                }
            }
        });

        return slots;
    };

    // function that handles the appointment booking process
    const bookAppointment = async (slot) => {
        if (!calendarId) {
            Alert.alert("Error", "Calendar not available");
            return;
        }

        try {
            const response = await axios.post(
                `${process.env.EXPO_PUBLIC_BACKED_API_URL}/appointment/book`,
                {
                    doctor_id: parsedDoctor._id,
                    appointmentDate: selectedDate,
                    timeSlot: slot,
                }
            );

            if (response.status === 201) {
                const [startTime, endTime] = slot.split("-");
                const appointmentDate = new Date(
                    `${selectedDate}T${startTime}:00`
                );
                const endDate = new Date(`${selectedDate}T${endTime}:00`);

                const eventId = await ExpoCalendar.createEventAsync(
                    calendarId,
                    {
                        title: `Appointment with ${parsedDoctor.doctorName}`,
                        startDate: appointmentDate,
                        endDate: endDate,
                        timeZone: "GMT",
                        location: parsedDoctor.hospitalName,
                    }
                );

                await scheduleAppointmentNotification(
                    appointmentDate, 
                    parsedDoctor.doctorName,
                    parsedDoctor.location.coordinates[1],  
                    parsedDoctor.location.coordinates[0]  
                );

                Alert.alert("Success", "Appointment booked successfully!");
            } else if (response.status === 400) {
                Alert.alert(
                    "Slot Already Booked",
                    response.data.message ||
                        "The selected time slot is already booked."
                );
            } else {
                Alert.alert(
                    "Error",
                    response.data.message || "Failed to book appointment"
                );
            }
            fetchBookedSlots();
        } catch (error) {
            if (error.message == "Request failed with status code 400") {
                Alert.alert(
                    "Slot Already Booked",
                    "The selected time slot is already booked."
                );
            } else {
                Alert.alert(
                    "Error",
                    "An error occurred while booking the appointment"
                );
            }
            fetchBookedSlots();
        }
    };

    // request for push notificaitons, so that users can be notified 1 hour before the appointment time
    async function registerForPushNotificationsAsync() {
        let token;

        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });
        }

        if (Device.isDevice) {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;
            if (existingStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            }
            if (finalStatus !== 'granted') {
                alert('Failed to get push token for push notification!');
                return;
            }
            token = (await Notifications.getExpoPushTokenAsync()).data;
        } else {
            alert('Must use physical device for Push Notifications');
        }

        return token;
    }

    // function to schedule the notification for 1 hour prior to appointment time
    async function scheduleAppointmentNotification(appointmentDate, doctorName, latitude, longitude) {
        const notificationDate = new Date(appointmentDate);
        notificationDate.setHours(notificationDate.getHours() - 1); // 1 hour before appointment
    
        await Notifications.scheduleNotificationAsync({
            content: {
                title: "Upcoming Appointment Reminder",
                body: `You have an appointment with Dr. ${doctorName} in 1 hour.`,
                data: { 
                    appointmentDate: appointmentDate,
                    latitude: latitude,
                    longitude: longitude
                },
            },
            trigger: notificationDate,
        });
    }
    
    function setNotificationHandler() {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });
    
        Notifications.addNotificationResponseReceivedListener((response) => {
            const data = response.notification.request.content.data;
            if (data.latitude && data.longitude) {
                const url = `https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`;
                Linking.openURL(url);
            }
        });
    }


    return (
        <SafeAreaView className="flex-1">
            <ScrollView className="flex-1 bg-blue-100 p-4">
                <View className="bg-white p-4 mb-4 rounded-lg shadow-md  py-2">
                    <Text className="text-xl text-blue-700 font-poppins-bold">
                        {parsedDoctor.doctorName}
                    </Text>
                    <Text className="text-base font-poppins-regular text-neutral-700">
                        {parsedDoctor.specialization}
                    </Text>
                    <Text className="text-base font-poppins-regular text-neutral-700">
                        {parsedDoctor.hospitalName},{" "}
                        {parsedDoctor.hospitalAddress}
                    </Text>
                    <Text className="text-base font-poppins-regular text-neutral-700">
                        ₹ {parsedDoctor.fees}
                    </Text>
                </View>

                <View className="mb-4">
                    <RNCalendar
                    className="rounded-lg font-poppins-regular"
                        current={new Date().toISOString().split("T")[0]}
                        minDate={
                            new Date(
                                new Date().setDate(new Date().getDate() + 1)
                            )
                                .toISOString()
                                .split("T")[0]
                        }
                        maxDate={
                            new Date(
                                new Date().setDate(new Date().getDate() + 15)
                            )
                                .toISOString()
                                .split("T")[0]
                        }
                        onDayPress={(day) => {
                            setSelectedDate(day.dateString);
                            setLoading(true);
                            setSlotsFetched(false);
                        }}
                        markedDates={{
                            [selectedDate]: {
                                selected: true,
                                selectedColor: "#2563eb",
                            },
                        }}
                    />
                </View>

                {selectedDate && (
                    <View>
                        <Text className="text-xl font-poppins-bold text-blue-800 mb-2">
                            Available Slots:
                        </Text>
                        {loading ? (
                            <Text className="text-gray-600 text-start text-lg font-poppins-regular">
                                Loading...
                            </Text>
                        ) : slotsFetched ? (
                            generateSlots().length > 0 ? (
                                <View className="flex-wrap flex-row justify-between gap-y-2">
                                    {generateSlots().map((slot, index) => (
                                        <TouchableOpacity
                                            key={index}
                                            className="bg-blue-600 p-2 rounded w-40"
                                            onPress={() =>
                                                bookAppointment(slot)
                                            }
                                        >
                                            <Text className=" text-white text-center text-base font-poppins-medium">
                                                {slot}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            ) : (
                                <Text className="text-blue-700 text-center">
                                    No slots available
                                </Text>
                            )
                        ) : null}
                    </View>
                )}

                {!selectedDate && (
                    <Text className="text-blue-700 text-center text-base font-poppins-regular">
                        Please select a date to view available slots.
                    </Text>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

export default AppointmentBooking;